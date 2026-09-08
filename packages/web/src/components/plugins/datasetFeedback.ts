import type { DatasetDownloadJob } from "../../utils/api";

export function datasetWorkspacePath(job: Pick<DatasetDownloadJob, "datasetId" | "selectionId">): string {
  return `/data/datasets/${job.datasetId}${job.selectionId && job.selectionId !== "full" ? `--${job.selectionId}` : ""}`;
}

export function datasetErrorKey(message: string): string {
  if (/not installed|not on PATH|missing.*tool/i.test(message)) return "datasets.error.tools";
  if (/failed to fetch|fetch failed|network|NetworkError|ECONN|ENOTFOUND|timed? ?out|timeout/i.test(message)) return "datasets.error.network";
  if (/ENOSPC|not enough.*space|insufficient.*space/i.test(message)) return "datasets.error.space";
  if (/checksum|digest mismatch/i.test(message)) return "datasets.error.checksum";
  if (/401|403|credential|unauthori[sz]ed|forbidden/i.test(message)) return "datasets.error.access";
  return "datasets.error.generic";
}
