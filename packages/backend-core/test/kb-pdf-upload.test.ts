import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ensureKbRoot, KbPdfUploadError, readKbPdfBody, saveKbPdf, saveKbPdfStream } from "../src/kb-pdf-upload.js";

const pdf = new TextEncoder().encode("%PDF-1.7\nminimal test document");

afterEach(() => vi.unstubAllEnvs());

describe("knowledge-base PDF upload", () => {
  it("writes a valid PDF into source/pdf", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-upload-"));
    await expect(saveKbPdf(root, "paper.pdf", pdf)).resolves.toEqual({
      filename: "paper.pdf",
      size: pdf.byteLength,
    });
    expect(await readFile(join(root, "source", "pdf", "paper.pdf"), "utf8")).toContain("%PDF-1.7");
  });

  it.each(["../paper.pdf", "folder/paper.pdf", "paper.txt"])("rejects unsafe or non-PDF name %s", async (name) => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-upload-"));
    await expect(saveKbPdf(root, name, pdf)).rejects.toBeInstanceOf(KbPdfUploadError);
  });

  it("rejects spoofed PDFs and silent overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-upload-"));
    await expect(saveKbPdf(root, "fake.pdf", new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({
      status: 400,
      code: "KB_PDF_INVALID_CONTENT",
    });
    await saveKbPdf(root, "paper.pdf", pdf);
    await expect(saveKbPdf(root, "paper.pdf", pdf)).rejects.toMatchObject({
      status: 409,
      code: "KB_PDF_ALREADY_EXISTS",
    });
  });

  it("stops reading once the streaming upload exceeds its limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    await expect(readKbPdfBody(stream, 5)).rejects.toMatchObject({
      status: 413,
      code: "KB_PDF_TOO_LARGE",
    });
  });

  it("streams a PDF through a temp file and publishes it atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-stream-"));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("%PDF-"));
        controller.enqueue(new TextEncoder().encode("1.7\nstreamed"));
        controller.close();
      },
    });

    await expect(saveKbPdfStream(root, "streamed.pdf", stream)).resolves.toEqual({
      filename: "streamed.pdf",
      size: 17,
    });
    expect(await readFile(join(root, "source", "pdf", "streamed.pdf"), "utf8"))
      .toBe("%PDF-1.7\nstreamed");
    expect(await readdir(join(root, "source", "pdf"))).toEqual(["streamed.pdf"]);
  });

  it("removes the temp file when a streamed upload exceeds its limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-stream-limit-"));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("%PDF-1.7"));
        controller.close();
      },
    });

    await expect(saveKbPdfStream(root, "large.pdf", stream, 5)).rejects.toMatchObject({
      code: "KB_PDF_TOO_LARGE",
    });
    expect(await readdir(join(root, "source", "pdf"))).toEqual([]);
  });

  it("materializes bundled scripts into a writable persistent root", async () => {
    const source = await mkdtemp(join(tmpdir(), "bp-kb-source-"));
    const root = await mkdtemp(join(tmpdir(), "bp-kb-root-"));
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(join(source, "scripts", "build_kb.py"), "print('ok')\n");
    await expect(ensureKbRoot(root, source)).resolves.toBe(root);
    expect(await readFile(join(root, "scripts", "build_kb.py"), "utf8")).toContain("print('ok')");
  });

  it("returns a stable conflict code from the HTTP upload route", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-kb-route-"));
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "build_kb.py"), "print('ok')\n");
    vi.stubEnv("BP_KB_ROOT", root);
    const app = createApp({
      serveWeb: false,
      orchestrator: {
        ensureRuntime: async () => ({ baseUrl: "http://runtime.test" }),
        health: async () => true,
        stopRuntime: async () => {},
      },
    });
    const upload = () => app.request("/api/kb/pdfs?filename=paper.pdf", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Blob([pdf], { type: "application/pdf" }),
    });

    expect((await upload()).status).toBe(201);
    const duplicate = await upload();
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "KB_PDF_ALREADY_EXISTS" });
  });

  it("writes HTTP uploads to an explicitly mapped Docker host root", async () => {
    const fallbackRoot = await mkdtemp(join(tmpdir(), "bp-kb-fallback-"));
    const mappedRoot = await mkdtemp(join(tmpdir(), "bp-kb-mapped-"));
    for (const root of [fallbackRoot, mappedRoot]) {
      await mkdir(join(root, "scripts"), { recursive: true });
      await writeFile(join(root, "scripts", "build_kb.py"), "print('ok')\n");
    }
    vi.stubEnv("BP_KB_ROOT", fallbackRoot);
    const app = createApp({
      serveWeb: false,
      kbRoot: mappedRoot,
      orchestrator: {
        ensureRuntime: async () => ({ baseUrl: "http://runtime.test" }),
        health: async () => true,
        stopRuntime: async () => {},
      },
    });

    const response = await app.request("/api/kb/pdfs?filename=mapped.pdf", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Blob([pdf], { type: "application/pdf" }),
    });

    expect(response.status).toBe(201);
    expect(await readFile(join(mappedRoot, "source", "pdf", "mapped.pdf"), "utf8"))
      .toContain("%PDF-1.7");
  });

  it("rejects KB management APIs when the deployment disables them", async () => {
    const app = createApp({
      serveWeb: false,
      kbManagementEnabled: false,
      orchestrator: {
        ensureRuntime: async () => ({ baseUrl: "http://runtime.test" }),
        health: async () => true,
        stopRuntime: async () => {},
      },
    });

    const response = await app.request("/api/kb/pdfs?filename=blocked.pdf", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Blob([pdf], { type: "application/pdf" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "KB_MANAGEMENT_UNAVAILABLE" });
  });
});
