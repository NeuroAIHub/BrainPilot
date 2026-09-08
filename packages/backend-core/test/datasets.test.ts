import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { downloadHttpFile, listDatasetJobs, listDatasets, startDatasetDownload, cancelDatasetDownload, datasetDownloadRequirements } from "../src/datasets.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

function orchestrator(): Orchestrator {
  return {
    ensureRuntime: async (): Promise<RuntimeHandle> => ({ baseUrl: "http://runtime.test" }),
    health: async () => true,
    stopRuntime: async () => {},
  };
}

describe("dataset marketplace", () => {
  it("checks the selected recipe, including git-annex, without launching downloads", async () => {
    const bin = await mkdtemp(path.join(tmpdir(), "bp-tools-"));
    const executable = (name: string) => path.join(bin, name + (process.platform === "win32" ? ".EXE" : ""));
    await writeFile(executable("datalad"), "unused test executable", { mode: 0o755 });
    await writeFile(executable("git"), "unused test executable", { mode: 0o755 });
    const env = { PATH: bin, PATHEXT: ".EXE" };
    expect(await datasetDownloadRequirements("openneuro-ds000001", "first-participant", env)).toEqual({ tools: ["datalad", "git", "git-annex"], missing: ["git-annex"] });
    await writeFile(executable("git-annex"), "unused test executable", { mode: 0o755 });
    expect((await datasetDownloadRequirements("openneuro-ds000001", "first-participant", env)).missing).toEqual([]);
    expect(await datasetDownloadRequirements("physionet-eegmat", "sample", { PATH: "" })).toEqual({ tools: [], missing: [] });
    expect((await datasetDownloadRequirements("physionet-eegmat", "full", { PATH: "" })).missing).toEqual(["wget"]);
    await expect(datasetDownloadRequirements("physionet-eegmat", "unknown", env)).rejects.toThrow("not available");
  });

  it("does not create failed history entries for missing tools or expose checks in hosted mode", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-tools-route-"));
    vi.stubEnv("PATH", "");
    try {
      const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false });
      const check = await app.request("/api/datasets/openneuro-ds000001/requirements?selectionId=first-participant");
      expect((await check.json()).missing).toEqual(["datalad", "git", "git-annex"]);
      const start = await app.request("/api/datasets/openneuro-ds000001/download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectionId: "first-participant" }) });
      expect(start.status).toBe(400);
      expect(await listDatasetJobs(dataDir)).toEqual([]);
      const hosted = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false, env: { BP_LOCAL_MODE: "0" } });
      expect((await hosted.request("/api/datasets/openneuro-ds000001/requirements")).status).toBe(403);
    } finally { vi.unstubAllEnvs(); }
  });
  it("ships every downloader used by automatic recipes in the main image (#466)", () => {
    const dockerfile = readFileSync(
      new URL("../../../docker/main/Dockerfile", import.meta.url),
      "utf8",
    );
    for (const token of [
      "git-annex",
      "wget",
      "datalad==1.6.0",
      "dandi==0.76.7",
      "datalad --version",
      "dandi --version",
      "wget --version",
    ]) {
      expect(dockerfile).toContain(token);
    }
  });

  it("publishes metadata without exposing executable recipes", async () => {
    const entries = listDatasets();
    expect(entries.length).toBeGreaterThanOrEqual(48);
    expect(entries.every((entry) => entry.domains?.length && entry.summaryZh && entry.researchQuestions?.length)).toBe(true);
    expect(entries.flatMap((entry) => entry.downloadOptions ?? []).every((option) => !("recipe" in option))).toBe(true);
    expect(entries.find((entry) => entry.id === "physionet-eegmat")?.downloadOptions?.[0]?.tool).toBe("BrainPilot HTTP downloader");
    expect(entries.some((entry) => entry.access === "direct")).toBe(true);
    expect(entries.some((entry) => entry.access === "application")).toBe(true);
    expect(entries.every((entry) => !("recipe" in entry))).toBe(true);
    const ready = entries.filter((entry) => entry.downloadAvailable);
    expect(ready.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "openneuro-ds000114",
      "dandi-000021",
      "physionet-eegmmidb",
      "bci-competition-iv-2a",
    ]));
    expect(ready.every((entry) => Boolean(entry.downloadCommand) || entry.id === "mimic-iv" || entry.id === "hcp-young-adult" || entry.id === "kaggle-hms")).toBe(true);
    expect(entries.find((entry) => entry.id === "allen-cell-types")?.downloadAvailable).toBe(false);
    expect(entries.find((entry) => entry.id === "dandi-000026")?.downloadAvailable).toBe(false);
    expect(entries.find((entry) => entry.id === "dandi-000021")?.downloadReviewRequired).toBe(true);
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

  it.each([null, "bytes */2", "bytes */9"])("does not promote a partial file on unproven HTTP 416 (%s)", async (range) => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-416-"));
    const destination = path.join(root, "data.bin");
    await writeFile(`${destination}.part`, "partial");
    const fetchFn = vi.fn(async () => new Response(null, { status: 416, headers: range ? { "content-range": range } : {} }));
    await expect(downloadHttpFile("https://data.test/file", destination, { fetchFn })).rejects.toThrow("resume offset");
    expect(await readFile(`${destination}.part`, "utf8")).toBe("partial");
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("promotes an exact-length partial file on HTTP 416", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-complete-"));
    const destination = path.join(root, "data.bin");
    await writeFile(`${destination}.part`, "complete");
    const fetchFn = vi.fn(async () => new Response(null, { status: 416, headers: { "content-range": "bytes */8" } }));
    await downloadHttpFile("https://data.test/file", destination, { fetchFn });
    expect(await readFile(destination, "utf8")).toBe("complete");
  });

  it.each(["bytes 0-2/6", "bytes 3-8/6", "bytes 3-5/*"])("rejects invalid resume ranges (%s)", async (range) => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-range-"));
    const destination = path.join(root, "data.bin");
    await writeFile(`${destination}.part`, "abc");
    const fetchFn = vi.fn(async () => new Response("def", { status: 206, headers: { "content-range": range, "content-length": "3" } }));
    await expect(downloadHttpFile("https://data.test/file", destination, { fetchFn })).rejects.toThrow("Content-Range");
    expect(await readFile(`${destination}.part`, "utf8")).toBe("abc");
  });

  it("leaves unknown lengths unknown and rejects short bodies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-size-"));
    const fetchFn = vi.fn(async () => new Response("data"));
    const result = await downloadHttpFile("https://data.test/file", path.join(root, "unknown.bin"), { fetchFn });
    expect(result.totalBytes).toBeUndefined();
    await expect(downloadHttpFile("https://data.test/file", path.join(root, "short.bin"), {
      fetchFn: vi.fn(async () => new Response("data", { headers: { "content-length": "10" } })),
    })).rejects.toThrow("Incomplete");
    await expect(readFile(path.join(root, "short.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks provider hashes before completion and when reusing existing files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-hash-"));
    const destination = path.join(root, "data.bin");
    const checksum = { algorithm: "md5" as const, value: "8d777f385d3dfec8815d20f7496026dc" };
    const fetchFn = vi.fn(async () => new Response("data"));
    await downloadHttpFile("https://data.test/file", destination, { checksum, fetchFn });
    expect((await downloadHttpFile("https://data.test/file", destination, { checksum, fetchFn })).reused).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await writeFile(destination, "corrupt");
    await expect(downloadHttpFile("https://data.test/file", destination, { checksum, fetchFn })).rejects.toThrow("checksum mismatch");
    await expect(downloadHttpFile("https://data.test/file", path.join(root, "bad.bin"), {
      checksum, fetchFn: vi.fn(async () => new Response("corrupt")),
    })).rejects.toThrow("checksum mismatch");
    await expect(readFile(path.join(root, "bad.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["final", "complete partial", "resumed partial", "fresh download"])("recovers on retry after a checksum mismatch in a %s", async (source) => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-checksum-retry-"));
    const destination = path.join(root, "data.bin");
    const body = Buffer.from("data");
    const checksum = { algorithm: "md5" as const, value: "8d777f385d3dfec8815d20f7496026dc" };
    if (source === "final") await writeFile(destination, "xxxx");
    if (source === "complete partial") await writeFile(`${destination}.part`, "xxxx");
    if (source === "resumed partial") await writeFile(`${destination}.part`, "x");
    const ranges: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      ranges.push(range);
      const start = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
      if (start === body.length) {
        response.writeHead(416, { "content-range": `bytes */${body.length}` });
        response.end();
        return;
      }
      response.writeHead(start > 0 ? 206 : 200, {
        "content-length": body.length - start,
        ...(start > 0 ? { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
      });
      response.end(source === "fresh download" && ranges.length === 1 ? Buffer.from("xxxx") : body.subarray(start));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const url = `http://127.0.0.1:${address.port}/data.bin`;
      await expect(downloadHttpFile(url, destination, { checksum })).rejects.toThrow("Retry to download a fresh copy");
      await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(`${destination}.part`)).rejects.toMatchObject({ code: "ENOENT" });
      const preserved = await readdir(root);
      expect(preserved).toHaveLength(1);
      expect(preserved[0]).toMatch(/^data\.bin(?:\.part)?\.corrupt-/);
      const corruptBytes = source === "resumed partial" ? "xata" : "xxxx";
      expect(await readFile(path.join(root, preserved[0]), "utf8")).toBe(corruptBytes);

      const result = await downloadHttpFile(url, destination, { checksum });
      expect(result).toEqual({ bytesDownloaded: body.length, totalBytes: body.length, reused: false });
      expect(await readFile(destination)).toEqual(body);
      expect(ranges).toEqual(source === "final" ? [undefined]
        : [source === "complete partial" ? "bytes=4-" : source === "resumed partial" ? "bytes=1-" : undefined, undefined]);
      expect(await readFile(path.join(root, preserved[0]), "utf8")).toBe(corruptBytes);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("stops after each bad response and preserves distinct copies across explicit retries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-bad-provider-"));
    const destination = path.join(root, "data.bin");
    const checksum = { algorithm: "md5" as const, value: "8d777f385d3dfec8815d20f7496026dc" };
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("corrupt"));
    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(downloadHttpFile("https://data.test/file", destination, { checksum, fetchFn })).rejects.toThrow("checksum mismatch");
      expect(fetchFn).toHaveBeenCalledTimes(attempt);
    }
    const preserved = await readdir(root);
    expect(preserved).toHaveLength(2);
    for (const file of preserved) {
      expect(file).toMatch(/^data\.bin\.part\.corrupt-/);
      expect(await readFile(path.join(root, file), "utf8")).toBe("corrupt");
    }
    for (const [, init] of fetchFn.mock.calls) {
      expect(new Headers(init?.headers).has("Range")).toBe(false);
    }
  });

  it("does not quarantine an existing file when checksum verification is cancelled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-checksum-cancel-"));
    const destination = path.join(root, "data.bin");
    await writeFile(destination, "corrupt");
    const controller = new AbortController();
    const download = downloadHttpFile("https://data.test/file", destination, {
      checksum: { algorithm: "md5", value: "8d777f385d3dfec8815d20f7496026dc" }, signal: controller.signal,
    });
    // The synchronous preflight has passed; cancellation is observed during verification.
    controller.abort();
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(root)).toEqual(["data.bin"]);
    expect(await readFile(destination, "utf8")).toBe("corrupt");
  });

  it("deduplicates concurrent starts before creating the directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-race-"));
    const fetchFn = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("data"));
    try {
      const jobs = await Promise.all(Array.from({ length: 5 }, () => startDatasetDownload(root, "bci-competition-iv-2a")));
      expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
      await vi.waitFor(async () => expect((await listDatasetJobs(root))[0]?.status).toBe("completed"));
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally { fetchFn.mockRestore(); }
  });

  it("checks available space before writing a known-size transfer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-space-"));
    const destination = path.join(root, "large.bin");
    await expect(downloadHttpFile("https://data.test/file", destination, {
      availableBytes: async () => 2,
      fetchFn: vi.fn(async () => new Response("data", { headers: { "content-length": "4" } })),
    })).rejects.toThrow("disk space");
    await expect(readFile(`${destination}.part`)).rejects.toMatchObject({ code: "ENOENT" });
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
    expect(await listDatasetJobs(dataDir)).toEqual([]);
  });

  it("rejects unknown download scopes without starting a job", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-selection-"));
    await expect(startDatasetDownload(root, "physionet-eegmat", {}, "../../outside")).rejects.toThrow("not available");
    expect(await listDatasetJobs(root)).toEqual([]);
  });

  it("cancels an HTTP stream and preserves a resumable partial file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dataset-cancel-"));
    const fetchFn = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
    })));
    try {
      const job = await startDatasetDownload(root, "bci-competition-iv-2a");
      await vi.waitFor(async () => expect((await listDatasetJobs(root))[0]?.bytesDownloaded).toBe(3));
      await cancelDatasetDownload(root, job.id);
      await vi.waitFor(async () => expect((await listDatasetJobs(root))[0]?.status).toBe("cancelled"));
      expect(await readFile(path.join(job.targetDir, "BCICIV_2a_gdf.zip.part"))).toEqual(Buffer.from([1, 2, 3]));
      await expect(readFile(path.join(job.targetDir, "BCICIV_2a_gdf.zip"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { fetchFn.mockRestore(); }
  });

  it.skipIf(process.platform === "win32")("cancels an external downloader process group", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-command-cancel-"));
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "wget"), `#!${process.execPath}\nrequire("node:fs").writeFileSync("worker.pid", String(process.pid)); setInterval(() => {}, 100);`, { mode: 0o755 });
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    let launched: Awaited<ReturnType<typeof startDatasetDownload>> | undefined;
    try {
      launched = await startDatasetDownload(root, "physionet-eegmat");
      let pid = 0;
      await vi.waitFor(async () => { pid = Number(await readFile(path.join(launched!.targetDir, "worker.pid"), "utf8")); expect(pid).toBeGreaterThan(0); });
      await cancelDatasetDownload(root, launched.id);
      await vi.waitFor(async () => expect((await listDatasetJobs(root))[0]?.status).toBe("cancelled"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { if (launched) await cancelDatasetDownload(root, launched.id); vi.unstubAllEnvs(); }
  });

  it.skipIf(process.platform === "win32")("pins a DataLad revision before fetching only the selected participant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-datalad-scope-"));
    const bin = path.join(root, "bin"); await mkdir(bin);
    const script = `#!${process.execPath}\nrequire("node:fs").writeFileSync("cache-identity.json", JSON.stringify({name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL, committer: process.env.GIT_COMMITTER_NAME})); require("node:fs").appendFileSync("commands.jsonl", JSON.stringify([require("node:path").basename(process.argv[1]), ...process.argv.slice(2)]) + "\\n");`;
    for (const command of ["datalad", "git", "git-annex"]) await writeFile(path.join(bin, command), script, { mode: 0o755 });
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    try {
      const job = await startDatasetDownload(root, "openneuro-ds000001", {}, "first-participant");
      await vi.waitFor(async () => expect((await listDatasetJobs(root))[0]?.status).toBe("completed"));
      const commands = (await readFile(path.join(job.targetDir, "commands.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(commands[0]).toEqual(["datalad", "install", "-r", "-s", "https://github.com/OpenNeuroDatasets/ds000001.git", "."]);
      expect(commands[1]).toEqual(["git", "checkout", "--detach", "f8e27ac909e50b5b5e311f6be271f0b1757ebb7b"]);
      expect(commands[2]).toEqual(["datalad", "get", "-r", "--", "sub-01"]);
      expect(JSON.parse(await readFile(path.join(job.targetDir, "cache-identity.json"), "utf8"))).toEqual({ name: "BrainPilot dataset cache", email: "datasets@brainpilot.invalid", committer: "BrainPilot dataset cache" });
    } finally { vi.unstubAllEnvs(); }
  });

  it("does not expose host downloads in hosted mode", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bp-datasets-cloud-"));
    const directory = path.join(dataDir, "data", "datasets");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, ".jobs.json"), JSON.stringify([{ id: "private-job", datasetId: "example", datasetName: "Private local history", status: "completed", targetDir: "/local/private", startedAt: "2026-09-07T00:00:00Z" }]));
    const app = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false, env: { BP_LOCAL_MODE: "0" } });
    expect(await (await app.request("/api/datasets/downloads")).json()).toEqual([]);
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
    expect(await listDatasetJobs(first)).toEqual([]);
    expect(await listDatasetJobs(second)).toEqual([]);
  });
});
