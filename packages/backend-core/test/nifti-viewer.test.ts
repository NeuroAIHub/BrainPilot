import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type PostedMessage = { type: string; message?: string; metadata?: Record<string, unknown> };

async function viewerHarness() {
  const html = await readFile(new URL("../plugins/nifti-viewer/0.1.1/ui/index.html", import.meta.url), "utf8");
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error("NIfTI viewer script not found");
  const posted: PostedMessage[] = [];
  const elements = new Map<string, Record<string, unknown>>();
  const element = (selector: string) => {
    let current = elements.get(selector);
    if (!current) {
      current = {
        textContent: "",
        hidden: false,
        replaceChildren(...children: unknown[]) { this.children = children; },
        getContext() {
          return {
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData() {},
          };
        },
      };
      elements.set(selector, current);
    }
    return current;
  };
  let onMessage: ((event: { source: unknown; data: Record<string, unknown> }) => void) | undefined;
  const parent = { postMessage(message: PostedMessage) { posted.push(message); } };
  vm.runInContext(source, vm.createContext({
    location: { hash: "#token" },
    parent,
    document: { querySelector: element, createElement: () => ({ textContent: "" }) },
    addEventListener(type: string, handler: typeof onMessage) { if (type === "message") onMessage = handler; },
    Blob,
    DecompressionStream,
    TextDecoder,
    DataView,
    Uint8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    Number,
    Math,
    String,
    Array,
    Infinity,
  }));
  return {
    posted,
    elements,
    send(data: Record<string, unknown>) {
      onMessage?.({ source: parent, data: { token: "token", rpcVersion: "1", ...data } });
    },
  };
}

function nifti1(): ArrayBuffer {
  const buffer = new ArrayBuffer(384);
  const view = new DataView(buffer);
  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, 2, true);
  view.setInt16(44, 2, true);
  view.setInt16(46, 2, true);
  view.setInt16(70, 16, true);
  view.setFloat32(80, 1, true);
  view.setFloat32(84, 1, true);
  view.setFloat32(88, 1, true);
  view.setFloat32(108, 352, true);
  view.setFloat32(112, 1, true);
  new Uint8Array(buffer, 344, 4).set([110, 43, 49, 0]);
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((value, index) => view.setFloat32(352 + index * 4, value, true));
  return buffer;
}

describe("NIfTI viewer 0.1.1", () => {
  it("preserves range-backed .nii rendering", async () => {
    const harness = await viewerHarness();
    const source = nifti1();
    harness.send({
      type: "preview/open",
      requestId: "open-nii",
      file: { name: "subject.nii", size: source.byteLength, handle: "primary" },
      buffer: new ArrayBuffer(0),
    });
    expect(harness.posted.at(-1)).toMatchObject({ type: "preview/read-range" });
    harness.send({
      type: "preview/range-result",
      requestId: "nifti-header",
      handle: "primary",
      offset: 0,
      totalSize: source.byteLength,
      buffer: source.slice(0, 348),
    });
    harness.send({
      type: "preview/range-result",
      requestId: "nifti-slice",
      handle: "primary",
      offset: 368,
      totalSize: source.byteLength,
      buffer: source.slice(368, 384),
    });

    expect(harness.posted.find((message) => message.type === "preview/rendered")?.metadata)
      .toMatchObject({ format: "nifti-1", compressed: false, slice: 1 });
    expect(harness.elements.get("#status")?.textContent).toBe("Read-only preview");
  });

  it("decompresses .nii.gz and renders the central voxel-space z slice", async () => {
    const harness = await viewerHarness();
    const compressed = gzipSync(new Uint8Array(nifti1()));
    const buffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);

    harness.send({
      type: "preview/open",
      requestId: "open-gzip",
      file: { name: "subject.nii.gz", size: compressed.byteLength, handle: "primary" },
      buffer,
    });

    await vi.waitFor(() => {
      expect(harness.posted.find((message) => message.type === "preview/rendered")?.metadata)
        .toMatchObject({ format: "nifti-1", compressed: true, slice: 1 });
    });
    expect(harness.elements.get("#status")?.textContent).toBe("Read-only preview");
    expect(harness.elements.get("#note")?.textContent)
      .toContain("not guaranteed to be an anatomical axial plane");
  });

  it("reports invalid gzip data without crashing", async () => {
    const harness = await viewerHarness();
    harness.send({
      type: "preview/open",
      requestId: "open-invalid-gzip",
      file: { name: "broken.nii.gz", size: 4, handle: "primary" },
      buffer: new Uint8Array([1, 2, 3, 4]).buffer,
    });

    await vi.waitFor(() => expect(harness.posted.some((message) => message.type === "preview/error")).toBe(true));
    expect(harness.elements.get("#status")?.textContent).toBe("Preview failed");
  });

  it("rejects negative dimensions before requesting voxel data", async () => {
    const harness = await viewerHarness();
    const source = nifti1();
    new DataView(source).setInt16(42, -2, true);
    harness.send({
      type: "preview/open",
      requestId: "open-negative-dimension",
      file: { name: "broken.nii", size: source.byteLength, handle: "primary" },
      buffer: new ArrayBuffer(0),
    });
    harness.send({
      type: "preview/range-result",
      requestId: "nifti-header",
      handle: "primary",
      offset: 0,
      totalSize: source.byteLength,
      buffer: source.slice(0, 348),
    });

    expect(harness.posted.at(-1)).toMatchObject({ type: "preview/error" });
    expect(harness.posted.some((message) => message.type === "preview/read-range" && message.requestId === "nifti-slice"))
      .toBe(false);
  });

  it.each([
    ["non-finite", Number.NaN],
    ["negative", -4],
    ["fractional", 352.5],
  ])("rejects a %s gzip voxel offset instead of rendering plausible but misplaced data", async (_label, voxOffset) => {
    const harness = await viewerHarness();
    const source = nifti1();
    new DataView(source).setFloat32(108, voxOffset, true);
    const compressed = gzipSync(new Uint8Array(source));
    const buffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);

    harness.send({
      type: "preview/open",
      requestId: "open-invalid-offset",
      file: { name: "broken.nii.gz", size: compressed.byteLength, handle: "primary" },
      buffer,
    });

    await vi.waitFor(() => expect(harness.posted.some((message) => message.type === "preview/error")).toBe(true));
    expect(harness.posted.some((message) => message.type === "preview/rendered")).toBe(false);
    expect(harness.elements.get("#status")?.textContent).toBe("Preview failed");
  });
});
