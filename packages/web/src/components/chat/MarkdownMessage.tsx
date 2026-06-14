import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownMessageProps {
  content: string;
}

function MarkdownMessageImpl({ content }: MarkdownMessageProps) {
  return (
    <div className="message-card__content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoized so re-renders driven by unrelated parent state (e.g. a sibling
// component changing) don't re-parse markdown for every visible message —
// `content` is a string so default shallow-equal compare is precise.
export const MarkdownMessage = memo(MarkdownMessageImpl);

