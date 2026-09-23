import { describe, expect, it } from "vitest";
import { blobForPreview } from "../components/files/filePreview";

describe("binary file preview Blob", () => {
  it("labels a PDF for the browser viewer without changing its bytes", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255]);
    const responseBlob = new Blob([bytes], { type: "application/octet-stream" });

    const previewBlob = blobForPreview(responseBlob, "pdf");

    expect(previewBlob.type).toBe("application/pdf");
    expect(previewBlob.size).toBe(responseBlob.size);
    expect(new Uint8Array(await previewBlob.arrayBuffer())).toEqual(bytes);
    expect(responseBlob.type).toBe("application/octet-stream");
  });

  it("keeps image and download Blobs unchanged", () => {
    const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const other = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });

    expect(blobForPreview(image, "image")).toBe(image);
    expect(blobForPreview(other, "download")).toBe(other);
  });
});
