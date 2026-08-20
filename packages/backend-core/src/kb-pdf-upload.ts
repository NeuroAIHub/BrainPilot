import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBundledKbDir } from "@brainpilot/runtime";

export const KB_PDF_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

export class KbPdfUploadError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 413) {
    super(message);
  }
}

/** Materialize bundled pipeline scripts into an explicitly writable KB root. */
export async function ensureKbRoot(kbRoot: string, sourceOverride?: string): Promise<string> {
  try {
    await access(join(kbRoot, "scripts", "build_kb.py"));
    return kbRoot;
  } catch {
    const source = sourceOverride ?? resolveBundledKbDir();
    if (!source) throw new Error("Bundled Knowledge Base scripts are unavailable.");
    await mkdir(kbRoot, { recursive: true });
    await cp(source, kbRoot, { recursive: true, force: false, errorOnExist: false });
    await access(join(kbRoot, "scripts", "build_kb.py"));
    return kbRoot;
  }
}

export async function readKbPdfBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes = KB_PDF_UPLOAD_MAX_BYTES,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new KbPdfUploadError("The selected PDF exceeds the 256 MB upload limit.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safePdfName(raw: string): string {
  const name = raw.normalize("NFC").trim();
  if (!name || name.length > 240 || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new KbPdfUploadError("Choose a PDF with a valid filename.", 400);
  }
  if (!name.toLowerCase().endsWith(".pdf")) {
    throw new KbPdfUploadError("Only PDF files can be added to the knowledge base.", 400);
  }
  return name;
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
  return prefix.includes("%PDF-");
}

/** Save one user-selected PDF without path traversal or silent overwrite. */
export async function saveKbPdf(
  kbRoot: string,
  rawFilename: string,
  bytes: Uint8Array,
): Promise<{ filename: string; size: number }> {
  const filename = safePdfName(rawFilename);
  if (bytes.byteLength === 0) throw new KbPdfUploadError("The selected PDF is empty.", 400);
  if (bytes.byteLength > KB_PDF_UPLOAD_MAX_BYTES) {
    throw new KbPdfUploadError("The selected PDF exceeds the 256 MB upload limit.", 413);
  }
  if (!hasPdfSignature(bytes)) {
    throw new KbPdfUploadError("The selected file is not a valid PDF.", 400);
  }

  const pdfDir = join(kbRoot, "source", "pdf");
  await mkdir(pdfDir, { recursive: true });
  try {
    await writeFile(join(pdfDir, filename), bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new KbPdfUploadError("A PDF with this filename already exists. Rename it and try again.", 409);
    }
    throw error;
  }
  return { filename, size: bytes.byteLength };
}
