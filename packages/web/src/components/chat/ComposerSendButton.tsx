import { ArrowUp } from "lucide-react";
import { useDraft } from "../../contexts/draftStore";
import { IconButton } from "../primitives/IconButton";

interface ComposerSendButtonProps {
  sessionId: string | null;
  canSend: boolean;
  label: string;
}

/**
 * Send button that subscribes only to draftStore[sessionId] to compute its
 * disabled state. Sibling of ComposerInput; lives inside the same <form> in
 * PromptComposer, so click triggers normal form submission.
 *
 * Subscribing here (rather than passing isEmpty down from PromptComposer)
 * keeps the parent off the keystroke render path entirely.
 */
export function ComposerSendButton({ sessionId, canSend, label }: ComposerSendButtonProps) {
  const [draft] = useDraft(sessionId);
  return (
    <IconButton disabled={!canSend || !draft.trim()} label={label} type="submit" variant="strong">
      <ArrowUp size={18} />
    </IconButton>
  );
}
