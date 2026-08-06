import { describe, expect, it, vi } from "vitest";
import {
  datasetCardAction,
  handleDatasetCardAction,
  hasRequiredDatasetCredentials,
} from "../components/plugins/DatasetMarketplace";
import type { DatasetCatalogEntry } from "../utils/api";

function dataset(overrides: Partial<DatasetCatalogEntry> = {}): DatasetCatalogEntry {
  return {
    id: "public-eeg",
    name: "Public EEG",
    summary: "Public EEG fixture",
    description: "Fixture",
    provider: "Example",
    modalities: ["EEG"],
    license: "CC0",
    access: "direct",
    accessNote: "Public",
    homepage: "https://example.test/dataset",
    downloadAvailable: true,
    ...overrides,
  };
}

describe("dataset marketplace primary action", () => {
  it("starts a one-click download for public datasets without credentials", () => {
    const entry = dataset();
    const download = vi.fn();
    const showDetails = vi.fn();
    expect(handleDatasetCardAction(entry, { download, showDetails })).toBe("download");
    expect(download).toHaveBeenCalledWith(entry);
    expect(showDetails).not.toHaveBeenCalled();
  });

  it("opens the credential form instead of sending an empty download request", () => {
    const entry = dataset({
      id: "credentialed",
      access: "credentials",
      credentialFields: [{ id: "token", label: "API token", required: true, secret: true }],
    });
    const download = vi.fn();
    const showDetails = vi.fn();
    expect(handleDatasetCardAction(entry, { download, showDetails })).toBe("details");
    expect(showDetails).toHaveBeenCalledWith("credentialed");
    expect(download).not.toHaveBeenCalled();
  });

  it("opens details when no automated recipe is available", () => {
    expect(datasetCardAction(dataset({ downloadAvailable: false }))).toBe("details");
  });
});

describe("dataset credential validation", () => {
  const entry = dataset({
    credentialFields: [
      { id: "username", label: "Username", required: true },
      { id: "token", label: "Token", required: true, secret: true },
      { id: "session", label: "Optional session token", secret: true },
    ],
  });

  it("keeps download disabled until every required field is non-blank", () => {
    expect(hasRequiredDatasetCredentials(entry, {})).toBe(false);
    expect(hasRequiredDatasetCredentials(entry, { username: "researcher", token: "   " })).toBe(false);
    expect(hasRequiredDatasetCredentials(entry, { username: "researcher", token: "secret" })).toBe(true);
  });

  it("allows public datasets with no credential fields", () => {
    expect(hasRequiredDatasetCredentials(dataset(), {})).toBe(true);
  });
});
