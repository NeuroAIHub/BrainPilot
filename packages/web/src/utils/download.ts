/**
 * Browser download helpers shared across the file sidebar and the demo export.
 */

export function sanitizeDownloadName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = sanitizeDownloadName(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
