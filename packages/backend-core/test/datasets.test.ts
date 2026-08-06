import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { downloadHttpFile, listDatasetJobs, listDatasets } from "../src/datasets.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

function orchestrator(): Orchestrator {
  return {
    ensureRuntime: async (): Promise<RuntimeHandle> => ({ baseUrl: "http://runtime.test" }),
    health: async () => true,
    stopRuntime: async () => {},
  };
}

describe("dataset marketplace", () => {
  it("publishes metadata without exposing executable recipes", async () => {
    const entries = listDatasets();
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.some((entry) => entry.access === "direct")).toBe(true);
    expect(entries.some((entry) => entry.access === "application")).toBe(true);
    expect(entries.every((entry) => !("recipe" in entry))).toBe(true);
    const ready = entries.filter((entry) => entry.downloadAvailable);
    expect(ready.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "openneuro-ds000114",
      "dandi-000026",
      "physionet-eegmmidb",
      "bci-competition-iv-2a",
    ]));
    expect(ready.every((entry) => Boolean(entry.downloadCommand) || entry.id === "mimic-iv" || entry.id === "hcp-young-adult" || entry.id === "kaggle-hms")).toBe(true);
    expect(entries.find((entry) => entry.id === "allen-cell-types")?.downloadAvailable).toBe(false);
  });

  it("resumes an interrupted HTTP download with a Range request", async () => {
    const body = Buffer.from("brainpilot-dataset-download");
    const ranges: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      ranges.push(range);
      const start = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
      response.writeHead(start > 0 ? 206 : 200, {
        "content-length": body.length - start,
        ...(start > 0 ? { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
      });
      response.end(body.subarray(start));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-http-"));
      const destination = path.join(root, "dataset.bin");
      await writeFile(`${destination}.part`, body.subarray(0, 9));
      const progress: number[] = [];
      const result = await downloadHttpFile(`http://127.0.0.1:${address.port}/dataset.bin`, destination, { onProgress: (downloaded) => progress.push(downloaded) });
      expect(ranges).toEqual(["bytes=9-"]);
      expect(await readFile(destination)).toEqual(body);
      expect(result).toEqual({ bytesDownloaded: body.length, totalBytes: body.length, reused: false });
      expect(progress.at(-1)).toBe(body.length);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("restarts safely when a provider ignores the Range header", async () => {
    const body = Buffer.from("complete-file");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": body.length });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-range-ignore-"));
      const destination = path.join(root, "dataset.bin");
      await writeFile(`${destination}.part`, "stale-partial");
      await downloadHttpFile(`http://127.0.0.1:${address.port}/dataset.bin`, destination);
      expect(await readFile(destination)).toEqual(body);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("serves the catalogue and rejects downloads without required credentials", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-datasets-"));
    const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false });
    const response = await app.request("/api/datasets");
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown[]).toHaveLength(listDatasets().length);

    const download = await app.request("/api/datasets/kaggle-hms/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials: { username: "researcher" } }),
    });
    expect(download.status).toBe(400);
    expect(await download.json()).toEqual({ error: "Kaggle API token is required" });
    expect(listDatasetJobs(dataDir)).toEqual([]);
  });

  it("does not expose host downloads in hosted mode", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-datasets-cloud-"));
    const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false, env: { BP_LOCAL_MODE: "0" } });
    const response = await app.request("/api/datasets/openneuro-ds000030/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });

  it("keeps job registries isolated by data root", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "bp-datasets-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "bp-datasets-b-"));
    expect(listDatasetJobs(first)).toEqual([]);
    expect(listDatasetJobs(second)).toEqual([]);
  });
});
