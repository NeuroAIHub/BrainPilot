import { describe, expect, it } from "vitest";
import {
  extractClipboardImages,
  pastedImageNames,
} from "../components/chat/clipboardImages";

describe("clipboard image paste (#412)", () => {
  it("extracts only image files physically present in clipboard items", () => {
    const png = { name: "image.png", type: "image/png" } as File;
    const text = { name: "notes.txt", type: "text/plain" } as File;
    const data = {
      items: [
        { kind: "string", type: "text/html", getAsFile: () => null },
        { kind: "file", type: "text/plain", getAsFile: () => text },
        { kind: "file", type: "image/png", getAsFile: () => png },
      ],
      files: [],
    } as unknown as Pick<DataTransfer, "items" | "files">;

    expect(extractClipboardImages(data)).toEqual([png]);
  });

  it("falls back to clipboard files for browsers without usable items", () => {
    const jpeg = { name: "photo.jpg", type: "image/jpeg" } as File;
    const data = {
      items: [],
      files: [jpeg, { name: "report.pdf", type: "application/pdf" }],
    } as unknown as Pick<DataTransfer, "items" | "files">;

    expect(extractClipboardImages(data)).toEqual([jpeg]);
  });

  it("ignores remote HTML image references", () => {
    const data = {
      items: [{ kind: "string", type: "text/html", getAsFile: () => null }],
      files: [],
    } as unknown as Pick<DataTransfer, "items" | "files">;

    expect(extractClipboardImages(data)).toEqual([]);
  });

  it("generates unique names with MIME-derived extensions", () => {
    const now = new Date(2026, 7, 5, 9, 30, 12);
    expect(pastedImageNames(
      ["image/png", "image/jpeg", "image/webp"],
      ["pasted-image-20260805-093012-1.png"],
      now,
    )).toEqual([
      "pasted-image-20260805-093012-1-2.png",
      "pasted-image-20260805-093012-2.jpg",
      "pasted-image-20260805-093012-3.webp",
    ]);
  });
});
