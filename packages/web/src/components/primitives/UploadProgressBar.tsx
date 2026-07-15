import { X } from "lucide-react";
import { useT } from "../../i18n/useT";
import type { UploadProgress } from "../../utils/api";
import { RAW_UPLOAD_THRESHOLD_BYTES } from "../../utils/api";

export type UploadProgressBarProps = {
  filename: string;
  /** 1-based index when uploading multiple files sequentially. */
  fileIndex?: number;
  fileCount?: number;
  /** Original file size — drives percent vs indeterminate UI (≥ 4 MiB). */
  fileSize: number;
  percent: number | null;
  phase: UploadProgress["phase"];
  onCancel?: () => void;
};

/**
 * #305: minimal upload progress row shared by the chat composer and the
 * persistent-library upload control. No extra UI library — design tokens only.
 *
 * Display rules (product decision on #305):
 * - fileSize < 4 MiB → indeterminate bar (avoids 0→100 flash)
 * - fileSize ≥ 4 MiB → percent fill when available
 * - phase === "processing" → full bar + "Processing…" (proxy/runtime lag)
 */
export function UploadProgressBar({
  filename,
  fileIndex,
  fileCount,
  fileSize,
  percent,
  phase,
  onCancel,
}: UploadProgressBarProps) {
  const t = useT();
  const showPercent = fileSize >= RAW_UPLOAD_THRESHOLD_BYTES && percent != null && phase === "uploading";
  const indeterminate = phase === "uploading" && !showPercent;
  const processing = phase === "processing";
  const fill = processing || (showPercent && percent != null) ? (processing ? 100 : percent!) : 0;
  const multi = fileCount != null && fileCount > 1 && fileIndex != null;

  const statusLabel = processing
    ? t("upload.processing")
    : showPercent
      ? t("upload.percent", { percent: String(percent) })
      : t("upload.uploading");

  return (
    <div className="upload-progress" role="status" aria-live="polite" aria-busy="true">
      <div className="upload-progress__row">
        <span className="upload-progress__name" title={filename}>
          {filename}
        </span>
        {multi ? (
          <span className="upload-progress__index">
            {t("upload.fileIndex", { current: String(fileIndex), total: String(fileCount) })}
          </span>
        ) : null}
        <span className="upload-progress__status">{statusLabel}</span>
        {onCancel ? (
          <button
            type="button"
            className="upload-progress__cancel"
            onClick={onCancel}
            aria-label={t("upload.cancel")}
            title={t("upload.cancel")}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <div
        className={`upload-progress__track${indeterminate ? " upload-progress__track--indeterminate" : ""}`}
      >
        {indeterminate ? (
          <div className="upload-progress__bar upload-progress__bar--indeterminate" />
        ) : (
          <div className="upload-progress__bar" style={{ width: `${fill}%` }} />
        )}
      </div>
    </div>
  );
}
