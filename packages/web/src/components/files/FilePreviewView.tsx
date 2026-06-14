import { MarkdownMessage } from "../chat/MarkdownMessage";
import { TranslateVars } from "../../i18n/translate";
import { codeLanguage, isMarkdown } from "./filePreview";

/** Skip highlighting very large files to avoid blocking the main thread. */
const MAX_HIGHLIGHT_BYTES = 200_000;

/** A fence longer than any backtick run in the text, so content can't break out. */
function fenceFor(text: string): string {
  let max = 0;
  const runs = text.match(/`+/g);
  if (runs) {
    for (const r of runs) {
      max = Math.max(max, r.length);
    }
  }
  return "`".repeat(Math.max(3, max + 1));
}

export type PreviewSource =
  | { kind: "text"; text: string; truncated?: boolean }
  | { kind: "image"; blobUrl?: string }
  | { kind: "pdf"; blobUrl?: string }
  | { kind: "download"; blobUrl?: string }
  | { kind: "tooLarge" }
  | { kind: "unreadable"; detail?: string };

interface FilePreviewViewProps {
  name: string;
  source: PreviewSource;
  /** Render markdown (.md) text as formatted HTML instead of raw <pre>. */
  renderMarkdown?: boolean;
  /** Error loading the bytes (image/pdf), shown instead of the media. */
  error?: string | null;
  t: (key: string, vars?: TranslateVars) => string;
}

/**
 * Presentational file-content body — image / pdf / text / markdown / notices.
 * Extracted from FileSidebar's FilePreviewPanel so the live preview and the
 * demo player (which feeds embedded bytes) render identically. Callers own
 * blob-URL lifecycle and byte loading; this component only renders.
 */
export function FilePreviewView({ name, source, renderMarkdown, error, t }: FilePreviewViewProps) {
  if (source.kind === "tooLarge") {
    return <p className="file-preview__notice">{t("files.preview.tooLarge")}</p>;
  }
  if (source.kind === "unreadable") {
    return (
      <p className="file-preview__notice">
        {t("files.preview.unreadable")}
        {source.detail ? <small className="file-preview__notice-detail"> · {source.detail}</small> : null}
      </p>
    );
  }
  if (source.kind === "image") {
    return (
      <div className="file-preview__media">
        {error ? <p>{error}</p> : source.blobUrl ? <img alt={name} src={source.blobUrl} /> : <p>{t("files.preview.loadingImage")}</p>}
      </div>
    );
  }
  if (source.kind === "pdf") {
    return (
      <div className="file-preview__media">
        {error ? <p>{error}</p> : source.blobUrl ? <iframe src={source.blobUrl} title={name} /> : <p>{t("files.preview.loadingPdf")}</p>}
      </div>
    );
  }
  if (source.kind === "download") {
    return <p className="file-preview__notice">{t("files.preview.notPreviewable")}</p>;
  }
  // text
  if (renderMarkdown && isMarkdown(name)) {
    return (
      <div className="file-preview__markdown">
        <MarkdownMessage content={source.text} />
      </div>
    );
  }
  // Syntax-highlight code/text by rendering it as a fenced code block through
  // the markdown pipeline (reuses rehype-highlight + the chat code theme; no
  // extra bundle weight). Falls back to plain text for unknown or huge files.
  const lang = codeLanguage(name);
  if (lang !== "plaintext" && source.text.length <= MAX_HIGHLIGHT_BYTES) {
    const fence = fenceFor(source.text);
    return (
      <div className="file-preview__markdown file-preview__code">
        <MarkdownMessage content={`${fence}${lang}\n${source.text}\n${fence}`} />
      </div>
    );
  }
  return (
    <pre className="file-preview__content">
      <code>{source.text}</code>
    </pre>
  );
}
