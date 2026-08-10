import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerSendTools } from "../components/chat/ComposerSendTools";

// No jsdom/@testing-library in the monorepo, so we render the presentational
// send cluster to static markup and assert on the output. This guards #160:
// the file-upload (Paperclip) button + hidden <input type="file"> were removed
// from the composer's send cluster because upload was never a supported
// feature. Anyone re-adding an upload control here makes this test fail.
describe("ComposerSendTools — #160 no file-upload control", () => {
  const markup = () =>
    renderToStaticMarkup(
      <ComposerSendTools
        modelSelect={<div className="model-select">model</div>}
        thinkingSelect={<div className="thinking-select">medium</div>}
        sendButton={<button type="submit">send</button>}
      />,
    );

  it("renders the passed-in model picker and send button", () => {
    const html = markup();
    expect(html).toContain("composer__send-tools");
    expect(html).toContain("model-select");
    expect(html).toContain("thinking-select");
    expect(html).toContain("send");
  });

  it("renders no file input (upload removed)", () => {
    const html = markup();
    expect(html).not.toContain('type="file"');
  });

  it("renders only the two nodes it is given — no extra upload button", () => {
    // The cluster owns no controls of its own; it only lays out what the parent
    // passes. A stray <input>/upload button would mean upload crept back in.
    const html = markup();
    expect(html).not.toContain("<input");
  });
});
