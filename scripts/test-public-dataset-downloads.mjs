import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadHttpFile } from "../packages/backend-core/dist/datasets.js";

const root = await mkdtemp(path.join(tmpdir(), "brainpilot-dataset-smoke-"));
const results = [];

try {
  const records = path.join(root, "physionet-RECORDS");
  await downloadHttpFile("https://physionet.org/files/eegmmidb/1.0.0/RECORDS", records);
  const firstRecord = (await readFile(records, "utf8")).split("\n")[0];
  if (!firstRecord?.endsWith(".edf")) throw new Error("PhysioNet RECORDS did not contain EDF paths");
  results.push(`PhysioNet: downloaded RECORDS (${firstRecord})`);

  const bci = await fetch("https://www.bbci.de/competition/download/competition_iv/BCICIV_2a_gdf.zip", {
    method: "HEAD",
    signal: AbortSignal.timeout(30_000),
  });
  if (!bci.ok || bci.headers.get("content-type") !== "application/zip") throw new Error(`BCI archive probe failed (${bci.status})`);
  results.push(`BCI IV 2a: archive available (${bci.headers.get("content-length") ?? "unknown"} bytes)`);

  const openneuroHead = execFileSync("git", ["ls-remote", "https://github.com/OpenNeuroDatasets/ds000114.git", "HEAD"], { encoding: "utf8", timeout: 30_000 }).trim();
  if (!/^[0-9a-f]{40}\s+HEAD$/i.test(openneuroHead)) throw new Error("OpenNeuro repository did not return a HEAD commit");
  results.push(`OpenNeuro ds000114: repository available (${openneuroHead.slice(0, 12)})`);

  const dandiVersion = spawnSync("dandi", ["--version"], { encoding: "utf8" });
  if (dandiVersion.error?.code === "ENOENT") {
    results.push("DANDI 000026: skipped metadata download (dandi CLI is not installed)");
  } else {
    const dandiRoot = path.join(root, "dandi");
    await mkdir(dandiRoot, { recursive: true });
    execFileSync("dandi", ["download", "--format", "PYOUT", "--path-type", "EXACT", "--existing", "REFRESH", "--download", "dandiset.yaml", "--output-dir", dandiRoot, "DANDI:000026"], { stdio: "ignore", timeout: 60_000 });
    const metadata = await readFile(path.join(dandiRoot, "000026", "dandiset.yaml"), "utf8");
    if (!metadata.includes("identifier: DANDI:000026")) throw new Error("DANDI metadata identifier did not match");
    results.push("DANDI 000026: downloaded and validated dandiset.yaml");
  }

  for (const result of results) console.log(`✓ ${result}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
