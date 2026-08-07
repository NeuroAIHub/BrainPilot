import { memo, type MouseEvent } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { normalizeMarkdownForRendering } from "./normalizeMarkdown";
import { parseWorkspaceFileHref, type WorkspaceFileTarget } from "./workspaceFileLink";

interface MarkdownMessageProps {
  content: string;
  onOpenWorkspaceFile?: (target: WorkspaceFileTarget) => void;
}

function MarkdownMessageImpl({ content, onOpenWorkspaceFile }: MarkdownMessageProps) {
  const normalizedContent = normalizeMarkdownForRendering(content);

  return (
    <div className="message-card__content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        urlTransform={(url) => parseWorkspaceFileHref(url) ? url : defaultUrlTransform(url)}
        components={{
          a: ({ href, children, node: _node, ...props }) => {
            const target = href ? parseWorkspaceFileHref(href) : null;
            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (!target) return;
              event.preventDefault();
              onOpenWorkspaceFile?.(target);
            };
            return (
              <a
                {...props}
                href={href}
                data-workspace-file={target ? target.path : undefined}
                onClick={handleClick}
              >
                {children}
              </a>
            );
          },
        }}
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
