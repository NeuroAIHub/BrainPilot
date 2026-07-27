import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { normalizeMarkdownForRendering } from "./normalizeMarkdown";

interface MarkdownMessageProps {
  content: string;
}

function MarkdownMessageImpl({ content }: MarkdownMessageProps) {
  const normalizedContent = normalizeMarkdownForRendering(content);

  return (
    <div className="message-card__content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

// Memoized so re-renders driven by unrelated parent state (e.g. a sibling
// component changing) don't re-parse markdown for every visible message —
// `content` is a string so default shallow-equal compare is precise.
export const MarkdownMessage = memo(MarkdownMessageImpl);
