import { useEffect } from "react";
import { GitBranch, X } from "lucide-react";
import type { TraceNode } from "../../contracts/backend";
import type { TranslateVars } from "../../i18n/translate";
import { IconButton } from "../primitives/IconButton";
import { TraceNodeDetail } from "../session/TraceNodeDetail";

interface TraceNodeModalProps {
  node: TraceNode | null;
  onClose: () => void;
  onSelectNode: (id: string) => void;
  /** Focus a produced file in the preview (closes the modal). */
  onSelectArtifact: (path: string) => void;
  activeArtifactPath: string | null;
  closeLabel: string;
  t: (key: string, vars?: TranslateVars) => string;
}

/**
 * Popup showing a single reasoning-trace node's full info (what the agent did,
 * dependencies, tool calls, produced files). Reuses the app's modal pattern
 * (fixed backdrop + centered panel, click-outside / Escape to close) and the
 * shared TraceNodeDetail body.
 */
export function TraceNodeModal({ node, onClose, onSelectNode, onSelectArtifact, activeArtifactPath, closeLabel, t }: TraceNodeModalProps) {
  useEffect(() => {
    if (!node) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [node, onClose]);

  if (!node) {
    return null;
  }

  return (
    <div className="trace-node-modal" onMouseDown={onClose} role="presentation">
      <section
        className="trace-node-modal__panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={node.title}
      >
        <div className="trace-node-modal__head">
          <span className="trace-node-modal__eyebrow">
            <GitBranch size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            {node.id}
          </span>
          <IconButton label={closeLabel} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="trace-node-modal__body trace-detail">
          <TraceNodeDetail
            node={node}
            onSelectNode={onSelectNode}
            onSelectArtifact={(path) => {
              onSelectArtifact(path);
              onClose();
            }}
            activeArtifactPath={activeArtifactPath}
            t={t}
          />
        </div>
      </section>
    </div>
  );
}
