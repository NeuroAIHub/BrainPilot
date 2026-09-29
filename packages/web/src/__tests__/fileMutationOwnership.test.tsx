import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// No jsdom in this monorepo (see vitest.config.ts), so the panel is mounted with
// react-test-renderer and driven through its rendered props. The contexts, the
// API and the translator are mocked; `window.confirm` is stubbed per test.
//
// Deferred file APIs exercise the real component handlers. A mutation must
// update only the editor and workspace generation that started it.

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
  readRawFile: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
  enabledPreviewers: vi.fn(),
  getInfo: vi.fn(),
  // Stable identities: the panel's effects depend on these objects, so a fresh
  // literal per render would re-run them forever.
  sandbox: { currentSandbox: { id: "sbx", status: "running" } },
  session: { currentSession: { id: "s1" }, messages: [] as unknown[] },
  // `loadDirectory` lists `t` in its deps, so the translator must be stable too.
  t: (k: string, params?: Record<string, string>) => k === "files.editor.backgroundSaveFailed"
    ? `Background save of ${params?.path}: ${params?.detail}` : k,
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
      uploadFile: mocks.uploadFile,
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
let onSelectionLocationChange: Mock<(target: { path: string; line?: number } | null) => void>;
let onUseInConversation: Mock<(path: string) => void>;
let confirmMock: ReturnType<typeof vi.fn>;
let dirtyChanges: Mock<(dirty: boolean) => void>;

const noop = () => {};

async function mount(openFileRequest: { path: string; line?: number; requestId: number } | null = null) {
  await act(async () => {
    renderer = create(sidebarElement(openFileRequest));
  });
  await flush();
}

function sidebarElement(openFileRequest: { path: string; line?: number; requestId: number } | null = null, isOpen = true) {
  return <FileSidebar
    isOpen={isOpen}
    openFileRequest={openFileRequest}
    onClose={noop}
    onDirtyChange={dirtyChanges}
    onSelectionLocationChange={onSelectionLocationChange}
    onUseInConversation={onUseInConversation}
    onResize={noop}
    onResizeEnd={noop}
    onResizeStart={noop}
    width={320}
  />;
}

async function switchSession(id: string) {
  mocks.session.currentSession.id = id;
  await act(async () => renderer.update(sidebarElement()));
  await flush();
}

async function setSidebarOpen(isOpen: boolean) {
  await act(async () => renderer.update(sidebarElement(null, isOpen)));
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
  mocks.session.currentSession.id = "s1";
  mocks.listFiles.mockReset().mockResolvedValue([entry("a.md"), entry("b.md")]);
  mocks.readFile.mockReset().mockImplementation((_id: string, path: string) =>
    Promise.resolve(content(path, `body of ${path}`)),
  );
  mocks.deleteFile.mockReset().mockResolvedValue(undefined);
  mocks.readRawFile.mockReset().mockResolvedValue(new Blob());
  mocks.enabledPreviewers.mockReset().mockResolvedValue([]);
  mocks.getInfo.mockReset().mockResolvedValue({ localMode: true, workspacesRoot: "" });
  dirtyChanges = vi.fn<(dirty: boolean) => void>();
  mocks.uploadFile.mockReset().mockResolvedValue({ size: 12 });
  onSelectionLocationChange = vi.fn<(target: { path: string; line?: number } | null) => void>();
  onUseInConversation = vi.fn<(path: string) => void>();
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


function panel() {
  return renderer.root.findAll((node) => typeof node.type === "function" && node.props.onDraftChange !== undefined)[0].props;
}
async function edit(text: string) {
  await act(async () => panel().onEdit());
  await act(async () => panel().onDraftChange(text));
  await flush();
}
function deleteA() {
  const row = renderer.root.findAll((node) => node.type === "button" && node.props["aria-label"] === "files.aria.delete")[0];
  act(() => { void row.props.onClick({ stopPropagation() {} }); });
}
const observed = () => ({
  file: panel().file?.path ?? null,
  contentPath: panel().content?.path ?? null,
  draft: panel().draftContent,
  dirty: panel().isDirty,
  hostDirty: dirtyChanges.mock.calls.at(-1)?.[0],
});

describe("P1/P2 audit: file mutations must belong to their original selection", () => {
  it("P1: finishing deletion of A must not discard B's later unsaved edit", async () => {
    const deletion = deferred<void>();
    mocks.deleteFile.mockReturnValueOnce(deletion.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    deleteA();
    await flush();
    expect(mocks.deleteFile).toHaveBeenCalledWith("s1", "/workspace/a.md");
    await act(async () => openRow("b.md").props.onClick());
    await edit("B: important unsaved draft");
    expect(observed().dirty).toBe(true);
    deletion.resolve();
    await flush();
    const afterDelete = observed();
    const confirmationsBeforeReopen = confirmMock.mock.calls.length;
    await act(async () => openRow("b.md").props.onClick());
    await flush();
    expect(afterDelete.file).toBe("/workspace/b.md");
    expect(afterDelete.hostDirty).toBe(true);
    expect(panel().draftContent).toBe("B: important unsaved draft");
    expect(confirmMock.mock.calls.length).toBe(confirmationsBeforeReopen);
  });
  it("control: deleting unselected A preserves already-selected B and its draft", async () => {
    const deletion = deferred<void>();
    mocks.deleteFile.mockReturnValueOnce(deletion.promise);
    await mount();
    await act(async () => openRow("b.md").props.onClick());
    deleteA();
    await edit("B: preserved draft");
    deletion.resolve();
    await flush();
    expect(panel().file?.path).toBe("/workspace/b.md");
    expect(panel().draftContent).toBe("B: preserved draft");
    expect(panel().isDirty).toBe(true);
  });
  it("P2: late save of A must not replace B's save baseline or create a false conflict", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A: saved payload");
    act(() => { void panel().onSave(false); });
    await flush();
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    await act(async () => openRow("b.md").props.onClick());
    const before = observed();
    saving.resolve({ size: 16 });
    await flush();
    const after = observed();
    const rendered = renderer.root.findAll(n => typeof n.type === "function" && n.props.name === "b.md" && n.props.source?.kind === "text")[0]?.props.source.text;
    // B's visible text still comes from draftContent. The bad save baseline
    // instead makes unchanged B dirty and invents a conflict on a valid Save.
    if (panel().isDirty && !panel().isSaving) {
      act(() => { void panel().onSave(false); });
      await flush();
    }
    const conflict = panel().conflictContent ?? null;
    expect(before.dirty).toBe(false);
    expect(after.file).toBe("/workspace/b.md");
    expect(rendered).toBe("body of /workspace/b.md");
    expect(after.contentPath).toBe("/workspace/b.md");
    expect(after.dirty).toBe(false);
    expect(conflict).toBeNull();
    expect(mocks.uploadFile.mock.calls.map((call) => call[1])).toEqual(["/workspace/a.md"]);
  });
  it("P2: late save after preview close must not resurrect a hidden dirty buffer", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A: saved payload");
    act(() => { void panel().onSave(false); });
    await flush();
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    await act(async () => previewCloseHandler()());
    await flush();
    expect(panel().file).toBeNull();
    expect(panel().isDirty).toBe(false);
    saving.resolve({ size: 16 });
    await flush();
    expect(panel().content).toBeNull();
    expect(panel().isDirty).toBe(false);
    expect(dirtyChanges.mock.calls.at(-1)?.[0]).toBe(false);
  });
  it("control: saving the still-selected A converges to a clean buffer", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A: saved payload");
    act(() => { void panel().onSave(false); });
    await flush();
    saving.resolve({ size: 16 });
    await flush();
    expect(panel().content?.path).toBe("/workspace/a.md");
    expect(panel().content?.content).toBe("A: saved payload");
    expect(panel().isDirty).toBe(false);
  });
});

describe("file mutation completion ownership", () => {
  it("waits for a pending save before reopening the same path", async () => {
    let diskA = "body of /workspace/a.md";
    mocks.readFile.mockImplementation((_id: string, path: string) =>
      Promise.resolve(content(path, path.endsWith("a.md") ? diskA : `body of ${path}`)));
    const saving = deferred<void>();
    mocks.uploadFile.mockImplementationOnce(async (_id: string, _path: string, blob: Blob) => {
      await saving.promise;
      diskA = await blob.text();
      return { size: diskA.length };
    });
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("saved A");
    act(() => { void panel().onSave(false); });
    await flush();
    await act(async () => openRow("b.md").props.onClick());
    act(() => { void openRow("a.md").props.onClick(); });
    await flush();
    expect(mocks.readFile.mock.calls.filter((call) => call[1] === "/workspace/a.md")).toHaveLength(2);

    saving.resolve();
    await flush();
    expect(mocks.readFile.mock.calls.filter((call) => call[1] === "/workspace/a.md")).toHaveLength(3);
    expect(panel().file?.path).toBe("/workspace/a.md");
    expect(panel().content?.content).toBe("saved A");
    expect(panel().draftContent).toBe("saved A");
    expect(panel().isDirty).toBe(false);
  });

  it("rejects a duplicate Save before the button has rendered disabled", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("one save");
    act(() => { void panel().onSave(false); void panel().onSave(false); });
    await flush();
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    saving.resolve({ size: 8 });
    await flush();
    expect(panel().isDirty).toBe(false);
  });

  it("keeps a newer edit dirty when the earlier draft finishes saving", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A version one");
    act(() => { void panel().onSave(false); });
    await flush();
    await act(async () => panel().onDraftChange("A version two"));
    saving.resolve({ size: 13 });
    await flush();
    expect(panel().content?.content).toBe("A version one");
    expect(panel().draftContent).toBe("A version two");
    expect(panel().isDirty).toBe(true);
    expect(dirtyChanges.mock.calls.at(-1)?.[0]).toBe(true);
  });

  it("reopens the preview after a pending save fails with the disk baseline", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A draft that did not save");
    act(() => { void panel().onSave(false); });
    await flush();
    await act(async () => previewCloseHandler()());
    act(() => { void openRow("a.md").props.onClick(); });
    await flush();
    expect(panel().content).toBeNull();
    saving.reject(new Error("upload failed"));
    await flush();
    expect(panel().content?.content).toBe("body of /workspace/a.md");
    expect(panel().draftContent).toBe("body of /workspace/a.md");
    expect(panel().isDirty).toBe(false);
    const error = renderer.root.findAll((node) => node.props.className === "file-sidebar__error-text")[0];
    expect(error?.children.join("")).toContain("/workspace/a.md");
  });

  it("does not show an abandoned pane's save failure after close and reopen", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("discarded A draft");
    act(() => { void panel().onSave(false); });
    await flush();
    await setSidebarOpen(false);
    await setSidebarOpen(true);
    act(() => { void openRow("a.md").props.onClick(); });
    await flush();
    saving.reject(new Error("old upload failed"));
    await flush();
    expect(panel().content?.content).toBe("body of /workspace/a.md");
    expect(panel().isDirty).toBe(false);
    expect(renderer.root.findAll((node) => node.props.className === "file-sidebar__error-text")).toHaveLength(0);
  });

  it("keeps the owner's draft and conflict when disk content changed", async () => {
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("my unsaved draft");
    mocks.readFile.mockResolvedValueOnce(content("/workspace/a.md", "external edit"));
    await act(async () => { await panel().onSave(false); });
    expect(panel().draftContent).toBe("my unsaved draft");
    expect(panel().conflictContent?.content).toBe("external edit");
    expect(panel().isDirty).toBe(true);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("reports a background A save failure by path without changing B's editor", async () => {
    const saving = deferred<{ size: number }>();
    mocks.uploadFile.mockReturnValueOnce(saving.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("A draft");
    act(() => { void panel().onSave(false); });
    await flush();
    await act(async () => openRow("b.md").props.onClick());
    await edit("B draft");
    saving.reject(new Error("upload failed"));
    await flush();
    expect(panel().file?.path).toBe("/workspace/b.md");
    expect(panel().draftContent).toBe("B draft");
    expect(panel().isDirty).toBe(true);
    expect(panel().editError).toBeNull();
    const error = renderer.root.findAll((node) => node.props.className === "file-sidebar__error-text")[0];
    expect(error?.children.join("")).toContain("/workspace/a.md");
    expect(error?.children.join("")).toContain("upload failed");
  });

  it("drops old-session save results and lets the new session save its own file", async () => {
    const oldSave = deferred<{ size: number }>();
    mocks.uploadFile.mockImplementationOnce(() => oldSave.promise);
    mocks.listFiles.mockImplementation((id: string) => Promise.resolve(id === "s2" ? [entry("b.md")] : [entry("a.md"), entry("b.md")]));
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    await edit("old A draft");
    act(() => { void panel().onSave(false); });
    await flush();
    await switchSession("s2");
    expect(panel().file).toBeNull();
    await act(async () => openRow("b.md").props.onClick());
    await edit("new B draft");
    await act(async () => { await panel().onSave(false); });
    expect(mocks.uploadFile.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["s1", "/workspace/a.md"], ["s2", "/workspace/b.md"],
    ]);
    oldSave.resolve({ size: 11 });
    await flush();
    expect(panel().file?.path).toBe("/workspace/b.md");
    expect(panel().content?.content).toBe("new B draft");
    expect(panel().isDirty).toBe(false);
  });

  it("does not apply an old workspace directory result to a new session", async () => {
    const oldListing = deferred<ReturnType<typeof entry>[]>();
    await mount();
    mocks.listFiles.mockImplementation((id: string, path: string) =>
      id === "s1" && path === "/workspace" ? oldListing.promise : Promise.resolve([entry("b.md")]));
    await act(async () => openRow("a.md").props.onClick());
    await edit("saved A");
    act(() => { void panel().onSave(false); });
    await flush();
    expect(mocks.listFiles).toHaveBeenCalledWith("s1", "/workspace");
    await switchSession("s2");
    expect(openRow("b.md")).toBeDefined();
    oldListing.resolve([entry("old-only.md")]);
    await flush();
    expect(openRow("b.md")).toBeDefined();
    expect(() => openRow("old-only.md")).toThrow(/no row/);
  });

  it("ignores a deletion result after unmount", async () => {
    const deletion = deferred<void>();
    mocks.deleteFile.mockReturnValueOnce(deletion.promise);
    await mount();
    await act(async () => openRow("a.md").props.onClick());
    deleteA();
    await flush();
    await act(async () => renderer.unmount());
    onSelectionLocationChange.mockClear();
    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>;
    dispatch.mockClear();
    deletion.resolve();
    await flush();
    expect(onSelectionLocationChange).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
