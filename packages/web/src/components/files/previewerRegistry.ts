import { previewerExtensions, type EnabledPreviewer } from "@brainpilot/plugin-sdk/preview";

export type { EnabledPreviewer } from "@brainpilot/plugin-sdk/preview";

/** Longest matching suffix wins, then declared priority. */
export function matchEnabledPreviewer(fileName: string, previewers: EnabledPreviewer[]): EnabledPreviewer | null {
  const lower = fileName.toLowerCase();
  const matches = previewers.flatMap((candidate) => previewerExtensions(candidate.previewer)
    .filter((extension) => lower.endsWith(extension.toLowerCase()))
    .map((extension) => ({ candidate, length: extension.length })));
  matches.sort((a, b) => b.length - a.length || (b.candidate.previewer.priority ?? 0) - (a.candidate.previewer.priority ?? 0));
  return matches[0]?.candidate ?? null;
}
