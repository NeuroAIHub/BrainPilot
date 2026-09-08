// Small, live provider probes; never downloads an entire collection.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadHttpFile } from "../packages/backend-core/dist/datasets.js";

const root = await mkdtemp(path.join(tmpdir(), "bp-expanded-datasets-"));
const fetchFn = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
const results = [];
try {
  for (const id of ["sleep-edfx", "chbmit", "eegmat", "ucddb", "erpbci", "ltrsvp"]) {
    const base = `https://physionet.org/files/${id}/1.0.0/`;
    const records = path.join(root, `${id}-RECORDS`);
    const sums = path.join(root, `${id}-SHA256SUMS.txt`);
    await downloadHttpFile(`${base}RECORDS`, records, { fetchFn });
    await downloadHttpFile(`${base}SHA256SUMS.txt`, sums, { fetchFn });
    if (!(await readFile(records, "utf8")).trim() || !/^[a-f0-9]{64}\s/m.test(await readFile(sums, "utf8"))) throw new Error(`${id}: invalid provider manifest`);
    results.push(`${id}: versioned records and SHA-256 manifest downloaded`);
  }
  const checksumLines = await readFile(path.join(root, "eegmat-SHA256SUMS.txt"), "utf8");
  const line = checksumLines.split("\n").find((row) => row.endsWith("Subject00_2.edf"));
  if (!line) throw new Error("eegmat: sample missing from checksum manifest");
  const checksum = { algorithm: "sha256", value: line.split(/\s+/)[0] };
  const destination = path.join(root, "Subject00_2.edf");
  const url = "https://physionet.org/files/eegmat/1.0.0/Subject00_2.edf";
  const first = await downloadHttpFile(url, destination, { checksum, fetchFn });
  const body = await readFile(destination);
  await writeFile(`${destination}.part`, body.subarray(0, 128 * 1024));
  await rm(destination);
  const resumed = await downloadHttpFile(url, destination, { checksum, fetchFn });
  if (resumed.bytesDownloaded !== first.bytesDownloaded) throw new Error("sample resume size differs");
  results.push(`eegmat: real EDF downloaded and resumed, SHA-256 verified (${body.length} bytes)`);
  const dandi = await fetchFn("https://api.dandiarchive.org/api/dandisets/000021/versions/0.251116.2246/info/");
  if (!dandi.ok) throw new Error(`DANDI: HTTP ${dandi.status}`);
  const metadata = await dandi.json();
  if (!metadata.name.includes("Neuropixels")) throw new Error("DANDI identifier does not match Neuropixels");
  results.push(`DANDI 000021: pinned release matches ${metadata.name}`);
} finally {
  for (const result of results) console.log(`✓ ${result}`);
  await rm(root, { recursive: true, force: true });
}
