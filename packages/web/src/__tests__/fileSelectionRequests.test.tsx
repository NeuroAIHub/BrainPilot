import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// No jsdom in this monorepo (see vitest.config.ts), so the panel is mounted with
// react-test-renderer and driven through its rendered props. The contexts, the
// API and the translator are mocked; `window.confirm` is stubbed per test.
//
// What is under test: an explicit file selection must tell the host where the
// user is (so the address bar stays honest) without ever feeding itself a new
// `openFileRequest`, and an async read that answers late must not overwrite the
// file that is on screen now.

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
  readRawFile: vi.fn(),
  deleteFile: vi.fn(),
  enabledPreviewers: vi.fn(),
  getInfo: vi.fn(),
  // Stable identities: the panel's effects depend on these objects, so a fresh
  // literal per render would re-run them forever.
  sandbox: { currentSandbox: { id: "sbx", status: "running" } },
  session: { currentSession: { id: "s1" }, messages: [] as unknown[] },
  // `loadDirectory` lists `t` in its deps, so the translator must be stable too.
  t: (k: string) => k,
}));

vi.mock("../i18n/useT", () => ({ useT: () => mocks.t }));
vi.mock("../contexts/PreferencesContext", () => ({ usePreferences: () => ({ language: "zh-CN" }) }));
vi.mock("../config", () => ({ runtimeConfig: { localMode: true } }));
vi.mock("../contexts/SandboxContext", () => ({ useSandbox: () => mocks.sandbox }));
vi.mock("../contexts/SessionContext", () => ({ useSessions: () => mocks.session }));
vi.mock("../utils/api", () => ({
  isUploadAbortError: () => false,
  api: {
    getInfo: mocks.getInfo,
    sandbox: {
      listFiles: mocks.listFiles,
      readFile: mocks.readFile,
      readRawFile: mocks.readRawFile,
      deleteFile: mocks.deleteFile,
    },
    plugins: { enabledPreviewers: mocks.enabledPreviewers },
  },
}));

import { FileSidebar } from "../components/files/FileSidebar";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entry = (name: string) => ({
  name,
  path: `/workspace/${name}`,
  type: "file" as const,
  size: 12,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

const content = (path: string, text: string) => ({ path, content: text, size: text.length });

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let renderer: ReactTestRenderer;
let onSelectionLocationChange: ReturnType<typeof vi.fn>;
let onUseInConversation: ReturnType<typeof vi.fn>;
let confirmMock: ReturnType<typeof vi.fn>;

const noop = () => {};

async function mount(openFileRequest: { path: string; line?: number; requestId: number } | null = null) {
  await act(async () => {
    renderer = create(
      <FileSidebar
        isOpen
        openFileRequest={openFileRequest}
        onClose={noop}
        onSelectionLocationChange={onSelectionLocationChange}
        onUseInConversation={onUseInConversation}
        onResize={noop}
        onResizeEnd={noop}
        onResizeStart={noop}
        width={320}
      />,
    );
  });
  await flush();
}

/** The tree row's open button for `name` (folders and files share the class). */
function openRow(name: string) {
  const button = renderer.root
    .findAll((node) => node.type === "button" && node.props.className === "file-row__open")
    .find((node) => node.findAllByType("span").some((span) =>
      span.children.some((child) => typeof child === "string" && child.includes(name)),
    ));
  if (!button) throw new Error(`no row for ${name}`);
  return button;
}

/** The preview panel's close control, located by the handler it was given. */
function previewCloseHandler(): () => void {
  const panel = renderer.root.findAll(
    (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
  )[0];
  if (!panel) throw new Error("preview panel not mounted");
  return panel.props.onClose as () => void;
}

beforeEach(() => {
  mocks.listFiles.mockReset().mockResolvedValue([entry("a.md"), entry("b.md")]);
  mocks.readFile.mockReset().mockImplementation((_id: string, path: string) =>
    Promise.resolve(content(path, `body of ${path}`)),
  );
  mocks.deleteFile.mockReset().mockResolvedValue(undefined);
  mocks.readRawFile.mockReset().mockResolvedValue(new Blob());
  mocks.enabledPreviewers.mockReset().mockResolvedValue([]);
  mocks.getInfo.mockReset().mockResolvedValue({ localMode: true, workspacesRoot: "" });
  onSelectionLocationChange = vi.fn();
  onUseInConversation = vi.fn();
  confirmMock = vi.fn(() => true);
  // The node env has no `window`; the panel only needs the listener pair, the
  // discard prompt and a viewport width for its resize maths.
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    confirm: confirmMock,
    innerWidth: 1440,
  });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("explicit selection reports its location", () => {
  it("publishes the file the user picked in the tree", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await flush();
    expect(onSelectionLocationChange).toHaveBeenCalledWith({ path: "/workspace/a.md", line: undefined });
  });

  it("replaces the location — including the line target — when another file is picked", async () => {
    await mount({ path: "/workspace/a.md", line: 42, requestId: 1 });
    await flush();
    onSelectionLocationChange.mockClear();

    await act(async () => openRow("b.md").props.onClick());
    await flush();

    expect(onSelectionLocationChange).toHaveBeenCalledWith({ path: "/workspace/b.md", line: undefined });
  });

  it("keeps the line target when the already-open file is re-selected", async () => {
    await mount({ path: "/workspace/a.md", line: 42, requestId: 1 });
    await flush();
    onSelectionLocationChange.mockClear();

    await act(async () => openRow("a.md").props.onClick());
    await flush();

    // A plain tree click carries no line, so the deep link's line survives.
    expect(onSelectionLocationChange).toHaveBeenCalledWith({ path: "/workspace/a.md", line: 42 });
  });

  it("does not publish a location for a link-driven open (no request loop)", async () => {
    // The host wrote that URL before asking; echoing it back would generate a
    // fresh openFileRequest and re-drive this effect.
    await mount({ path: "/workspace/a.md", line: 7, requestId: 1 });
    await flush();
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
  });

  it("never publishes the transient empty selection of a pending deep link", async () => {
    const pending = deferred<ReturnType<typeof content>>();
    mocks.readFile.mockImplementationOnce(() => pending.promise);
    await mount({ path: "/workspace/a.md", line: 3, requestId: 1 });
    await flush();

    // Mid-load the selection has no content yet; the URL must be left alone.
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
    pending.resolve(content("/workspace/a.md", "loaded"));
    await flush();
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
  });
});

describe("closing the preview", () => {
  it("clears the obsolete location", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await flush();
    onSelectionLocationChange.mockClear();

    await act(async () => previewCloseHandler()());
    await flush();

    expect(onSelectionLocationChange).toHaveBeenCalledWith(null);
  });

  it("leaves everything untouched when the discard prompt is canceled", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await flush();

    // Make the buffer dirty so closing has to ask, then decline.
    const panel = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0];
    await act(async () => panel.props.onDraftChange("edited"));
    await flush();
    onSelectionLocationChange.mockClear();
    confirmMock.mockReturnValue(false);

    await act(async () => previewCloseHandler()());
    await flush();

    expect(confirmMock).toHaveBeenCalled();
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
    const after = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0];
    expect(after.props.file?.path).toBe("/workspace/a.md");
    expect(after.props.draftContent).toBe("edited");
    expect(after.props.isDirty).toBe(true);
  });
});

describe("stale read guard", () => {
  it("does not let a late read for A overwrite B", async () => {
    const slowA = deferred<ReturnType<typeof content>>();
    mocks.readFile.mockImplementationOnce(() => slowA.promise);
    await mount();

    await act(async () => openRow("a.md").props.onClick());
    await flush();
    await act(async () => openRow("b.md").props.onClick());
    await flush();

    const shown = () =>
      renderer.root.findAll(
        (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
      )[0].props;
    expect(shown().file?.path).toBe("/workspace/b.md");
    expect(shown().draftContent).toBe("body of /workspace/b.md");

    slowA.resolve(content("/workspace/a.md", "stale body of A"));
    await flush();

    expect(shown().file?.path).toBe("/workspace/b.md");
    expect(shown().draftContent).toBe("body of /workspace/b.md");
    expect(shown().content?.path).toBe("/workspace/b.md");
  });

  it("does not let a late failure for A raise an error over B", async () => {
    const failingA = deferred<ReturnType<typeof content>>();
    mocks.readFile.mockImplementationOnce(() => failingA.promise);
    await mount();

    await act(async () => openRow("a.md").props.onClick());
    await flush();
    await act(async () => openRow("b.md").props.onClick());
    await flush();

    failingA.reject(new Error("A exploded"));
    await flush();

    const shown = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0].props;
    expect(shown.editError).toBeNull();
    expect(shown.file?.path).toBe("/workspace/b.md");
  });

  it("does not repopulate a closed preview with a late read", async () => {
    const slowA = deferred<ReturnType<typeof content>>();
    mocks.readFile.mockImplementationOnce(() => slowA.promise);
    await mount();

    await act(async () => openRow("a.md").props.onClick());
    await flush();
    await act(async () => previewCloseHandler()());
    await flush();

    slowA.resolve(content("/workspace/a.md", "late body"));
    await flush();

    const shown = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0].props;
    expect(shown.file).toBeNull();
    expect(shown.content).toBeNull();
  });
});

describe("use in conversation", () => {
  it("asks once and hands the path to the host", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await flush();

    const panel = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0];
    await act(async () => panel.props.onDraftChange("edited"));
    await flush();

    await act(async () => panel.props.onUseInConversation());
    await flush();

    // The single guard lives here; the host must not add a second prompt.
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onUseInConversation).toHaveBeenCalledWith("/workspace/a.md");
  });

  it("does nothing when the single confirmation is declined", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await flush();

    const panel = renderer.root.findAll(
      (node) => typeof node.type === "function" && node.props.onDraftChange !== undefined,
    )[0];
    await act(async () => panel.props.onDraftChange("edited"));
    await flush();
    confirmMock.mockReturnValue(false);

    await act(async () => panel.props.onUseInConversation());
    await flush();

    expect(onUseInConversation).not.toHaveBeenCalled();
  });
});


describe("deleted preview location", () => {
  it("clears the obsolete location only after a successful deletion", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    onSelectionLocationChange.mockClear();
    const deleteButton = () => renderer.root.findAll((node) => node.type === "button" && node.props["aria-label"] === "files.aria.delete")[0];
    mocks.deleteFile.mockRejectedValueOnce(new Error("offline"));
    await act(async () => deleteButton().props.onClick({ stopPropagation() {} }));
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
    await act(async () => deleteButton().props.onClick({ stopPropagation() {} }));
    expect(mocks.deleteFile).toHaveBeenLastCalledWith("s1", "/workspace/a.md");
    expect(onSelectionLocationChange).toHaveBeenCalledWith(null);
  });
});
