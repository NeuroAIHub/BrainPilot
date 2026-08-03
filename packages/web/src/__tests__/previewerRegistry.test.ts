import { describe, expect, it } from "vitest";
import { matchEnabledPreviewer, type EnabledPreviewer } from "../components/files/previewerRegistry";

function candidate(id: string, extensions: string[], priority = 0): EnabledPreviewer {
  return { pluginId: `org.test.${id}`, pluginVersion: "1.0.0", displayName: id, previewer: { id, extensions, priority, entry: "ui/index.html" } };
}

describe("previewer registry", () => {
  it("prefers the longest compound extension before priority", () => {
    const nii = candidate("nii", [".nii"], 999);
    const gzip = candidate("nifti-gzip", [".nii.gz"], 1);
    expect(matchEnabledPreviewer("subject.BOLD.NII.GZ", [nii, gzip])?.previewer.id).toBe("nifti-gzip");
  });

  it("uses priority for equal suffix matches", () => {
    expect(matchEnabledPreviewer("image.nii", [candidate("low", [".nii"], 1), candidate("high", [".nii"], 10)])?.previewer.id).toBe("high");
  });

  it("lets an independent worker plugin supersede a browser fallback for FIF", () => {
    const browserFallback = candidate("browser-neuro", [".fif", ".nwb", ".snirf"], 100);
    const worker = candidate("worker-neuro", [".fif", ".nwb", ".snirf"], 200);
    expect(matchEnabledPreviewer("recording.fif", [browserFallback, worker])?.pluginId).toBe(worker.pluginId);
  });
});
