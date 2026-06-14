/**
 * Pure helpers for classifying and describing workspace files. Shared by the
 * live file preview panel (FileSidebar) and the demo player's embedded preview.
 */

export const ONE_MB = 1024 * 1024;

export type PreviewKind = "text" | "image" | "pdf" | "download";

export function getPreviewKind(fileName: string): PreviewKind {
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileName)) {
    return "image";
  }
  if (/\.pdf$/i.test(fileName)) {
    return "pdf";
  }
  if (/\.(md|txt|py|yaml|yml|csv|json|ts|tsx|js|jsx|css|html|xml|toml|ini|log)$/i.test(fileName)) {
    return "text";
  }
  return "download";
}

export function isMarkdown(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

/**
 * highlight.js language id for a filename, for syntax-highlighted code preview.
 * Returns "plaintext" for plain/unknown text so callers skip highlighting.
 * Language ids are limited to those in highlight.js's "common" bundle.
 */
export function codeLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    css: "css",
    html: "xml",
    xml: "xml",
    toml: "ini",
    ini: "ini",
  };
  return map[ext] ?? "plaintext";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatModified(timestamp: number): string {
  if (!timestamp) {
    return "-";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

/** Best-effort MIME type from a file extension (used when embedding files). */
export function mimeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    py: "text/x-python",
    ts: "text/typescript",
    tsx: "text/typescript",
    js: "text/javascript",
    jsx: "text/javascript",
    css: "text/css",
    html: "text/html",
    xml: "application/xml",
    toml: "text/plain",
    ini: "text/plain",
    log: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}
