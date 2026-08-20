import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KbPdfUploadError, readKbPdfBody, saveKbPdf } from "../src/kb-pdf-upload.js";

const pdf = new TextEncoder().encode("%PDF-1.7\nminimal test document");

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
    await expect(saveKbPdf(root, "fake.pdf", new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({ status: 400 });
    await saveKbPdf(root, "paper.pdf", pdf);
    await expect(saveKbPdf(root, "paper.pdf", pdf)).rejects.toMatchObject({ status: 409 });
  });

  it("stops reading once the streaming upload exceeds its limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    await expect(readKbPdfBody(stream, 5)).rejects.toMatchObject({ status: 413 });
  });
});
