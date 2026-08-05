const MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

type ClipboardImageData = Pick<DataTransfer, "items" | "files">;

/**
 * Return image files that are actually present in the clipboard. HTML such as
 * `<img src="https://…">` is intentionally ignored: fetching remote clipboard
 * references would introduce cross-origin, privacy, and size concerns.
 */
export function extractClipboardImages(data: ClipboardImageData): File[] {
  const fromItems = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null);

  // Some browsers expose pasted files only through DataTransfer.files.
  return fromItems.length > 0
    ? fromItems
    : Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

function timestampForFilename(now: Date): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    part(now.getMonth() + 1),
    part(now.getDate()),
    "-",
    part(now.getHours()),
    part(now.getMinutes()),
    part(now.getSeconds()),
  ].join("");
}

/** Generate stable, human-readable names without overwriting prior pastes. */
export function pastedImageNames(
  mimeTypes: readonly string[],
  existingNames: readonly string[],
  now = new Date(),
): string[] {
  const used = new Set(existingNames);
  const timestamp = timestampForFilename(now);

  return mimeTypes.map((mimeType, index) => {
    const extension = MIME_EXTENSIONS[mimeType.toLowerCase()] ?? "png";
    const stem = `pasted-image-${timestamp}-${index + 1}`;
    let candidate = `${stem}.${extension}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${stem}-${suffix}.${extension}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

export function renamePastedImages(
  images: readonly File[],
  existingNames: readonly string[],
  now = new Date(),
): File[] {
  const names = pastedImageNames(images.map((image) => image.type), existingNames, now);
  return images.map((image, index) => new File([image], names[index]!, {
    type: image.type,
    lastModified: image.lastModified,
  }));
}

/** Rename and reserve a paste batch synchronously before any upload starts. */
export function reservePastedImages(
  images: readonly File[],
  reservedNames: Set<string>,
  now = new Date(),
): File[] {
  const renamed = renamePastedImages(images, [...reservedNames], now);
  for (const file of renamed) reservedNames.add(file.name);
  return renamed;
}

/** Offer clipboard images to a receiver; true means the paste was accepted. */
export function offerClipboardImages(
  data: ClipboardImageData,
  receiver: (files: File[]) => boolean,
): boolean {
  const images = extractClipboardImages(data);
  return images.length > 0 && receiver(images);
}
