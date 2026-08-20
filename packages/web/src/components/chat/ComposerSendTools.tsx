import type { ReactNode } from "react";

/**
 * ComposerSendTools — presentational layout for the composer's right-hand send
 * cluster (model picker + send button). Extracted from PromptComposer so the
 * cluster can be rendered in isolation under react-dom/server (the monorepo has
 * no jsdom/@testing-library). The stateful pieces — the model `CustomSelect`
 * with its async onChange, the `ComposerSendButton` — are built by the parent
 * and passed in as nodes; this component owns only the wrapper markup.
 *
 * #160: the file-upload (Paperclip) button used to live here and was removed —
 * file upload was never a supported feature (it depended on a sandbox that the
 * local non-Docker mode never provides). ComposerSendTools.test.tsx asserts the
 * rendered cluster contains no file input, guarding against it creeping back.
 */
export function ComposerSendTools({
  modelControl,
  sendButton,
}: {
  /** Combined provider/model + session reasoning control. */
  modelControl: ReactNode;
  /** The send button node. */
  sendButton: ReactNode;
}) {
  return (
    <div className="composer__send-tools">
      {modelControl}
      {sendButton}
    </div>
  );
}
