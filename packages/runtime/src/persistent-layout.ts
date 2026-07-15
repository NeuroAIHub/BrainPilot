/**
 * Persistent-library layout initialization and v1 -> v2 migration (#287).
 *
 * v1: <dataRoot>/data/<legacyUserId>/...
 * v2: <dataRoot>/data/...
 *
 * The marker deliberately lives outside data/: data/ is user-visible and a
 * directory-count heuristic cannot distinguish a v1 user id from a perfectly
 * valid v2 directory such as data/project/.
 */
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LAYOUT_VERSION = 2;
export const PERSISTENT_LAYOUT_MARKER = ".bp-persistent-layout.json";
export const PERSISTENT_LAYOUT_STAGING = ".bp-persistent-data-v1-migration";

type LayoutMarker =
  | { version: 2; status: "ready"; migratedFrom?: string; completedAt: string }
  | {
      version: 2;
      status: "migrating";
      phase: "prepared" | "staged";
      legacyUserId: string;
      startedAt: string;
    };

/** Reproduce the old resolver exactly, but only to locate a v1 directory. */
export function resolveLegacyPersistentUserId(
  opt?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (opt ?? env.BP_USER_ID ?? "").trim();
  const candidate = raw === "" ? "local" : raw;
  const safe = candidate.replace(/[\\/]/g, "_").replace(/\.\.+/g, "_");
  return safe === "" || safe === "." ? "local" : safe;
}

async function readMarker(path: string): Promise<LayoutMarker | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let marker: Partial<LayoutMarker>;
  try {
    marker = JSON.parse(raw) as Partial<LayoutMarker>;
  } catch {
    throw new Error(`invalid persistent-layout marker at ${path}`);
  }
  if (
    marker.version !== LAYOUT_VERSION ||
    (marker.status !== "ready" && marker.status !== "migrating")
  ) {
    throw new Error(`unsupported persistent-layout marker at ${path}`);
  }
  if (
    marker.status === "migrating" &&
    (typeof marker.legacyUserId !== "string" ||
      (marker.phase !== "prepared" && marker.phase !== "staged"))
  ) {
    throw new Error(`invalid in-progress persistent-layout marker at ${path}`);
  }
  return marker as LayoutMarker;
}

async function writeMarker(path: string, marker: LayoutMarker): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function readDirOrNull(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function isIgnorableDataRootEntry(entry: { name: string; isFile(): boolean }): boolean {
  // Finder creates this file merely by viewing data/. It is not persistent
  // library content and must not turn an otherwise unambiguous v1 tree into a
  // mixed-layout conflict.
  return entry.name === ".DS_Store" && entry.isFile();
}

function layoutConflict(dataDir: string, legacyUserId: string, entries: string[]): Error {
  return new Error(
    `[persistent-data] cannot migrate ${dataDir}/${legacyUserId}: data/ also contains ` +
      `${entries.join(", ")}. Move either the flat-layout entries or the legacy directory ` +
      `out of data/, then restart; no files were changed.`,
  );
}

async function finishStagedMigration(
  dataDir: string,
  stagingDir: string,
  markerPath: string,
  marker: Extract<LayoutMarker, { status: "migrating" }>,
): Promise<void> {
  const stagingEntries = await readDirOrNull(stagingDir);
  if (stagingEntries === null) {
    // phase=staged with no staging dir means the final rename completed and
    // the process stopped before it could write the ready marker.
    const dataEntries = await readDirOrNull(dataDir);
    if (dataEntries === null) {
      throw new Error(`[persistent-data] migration state is incomplete: both ${dataDir} and ${stagingDir} are missing`);
    }
  } else {
    const dataEntries = await readDirOrNull(dataDir);
    const meaningfulEntries = dataEntries?.filter((entry) => !isIgnorableDataRootEntry(entry));
    if (meaningfulEntries !== undefined && meaningfulEntries.length > 0) {
      throw new Error(
        `[persistent-data] cannot resume migration: ${dataDir} is non-empty while ${stagingDir} exists`,
      );
    }
    if (dataEntries !== null) {
      for (const entry of dataEntries) {
        if (isIgnorableDataRootEntry(entry)) await unlink(join(dataDir, entry.name));
      }
      await rmdir(dataDir);
    }
    await rename(stagingDir, dataDir);
  }

  await writeMarker(markerPath, {
    version: LAYOUT_VERSION,
    status: "ready",
    migratedFrom: `data/${marker.legacyUserId}`,
    completedAt: new Date().toISOString(),
  });
}

async function runOrResumeMigration(
  dataRoot: string,
  markerPath: string,
  marker: Extract<LayoutMarker, { status: "migrating" }>,
): Promise<void> {
  const dataDir = join(dataRoot, "data");
  const stagingDir = join(dataRoot, PERSISTENT_LAYOUT_STAGING);

  if (marker.phase === "prepared") {
    const stagingEntries = await readDirOrNull(stagingDir);
    if (stagingEntries === null) {
      const entries = await readDirOrNull(dataDir);
      if (entries === null) {
        throw new Error(`[persistent-data] migration source is missing: ${dataDir}`);
      }
      const others = entries.filter(
        (entry) => entry.name !== marker.legacyUserId && !isIgnorableDataRootEntry(entry),
      );
      const legacy = entries.find((entry) => entry.name === marker.legacyUserId);
      if (!legacy?.isDirectory() || others.length > 0) {
        throw layoutConflict(dataDir, marker.legacyUserId, others.map((entry) => entry.name));
      }
      await rename(join(dataDir, marker.legacyUserId), stagingDir);
    }
    marker = { ...marker, phase: "staged" };
    await writeMarker(markerPath, marker);
  }

  await finishStagedMigration(dataDir, stagingDir, markerPath, marker);
}

/**
 * Ensure v2 is ready before any /data access. Unexpected or ambiguous states
 * reject instead of serving a split library. The caller supplies a single
 * legacy id resolved with the old rules; directory counts are never used to
 * guess identity.
 */
export async function ensurePersistentLayout(
  dataRoot: string,
  legacyUserId: string,
): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  const markerPath = join(dataRoot, PERSISTENT_LAYOUT_MARKER);
  const stagingDir = join(dataRoot, PERSISTENT_LAYOUT_STAGING);
  const marker = await readMarker(markerPath);

  if (marker?.status === "ready") return;
  if (marker?.status === "migrating") {
    await runOrResumeMigration(dataRoot, markerPath, marker);
    return;
  }

  // A staging directory without its journal is not safe to infer or discard.
  if ((await readDirOrNull(stagingDir)) !== null) {
    throw new Error(
      `[persistent-data] found unjournaled migration staging directory at ${stagingDir}; ` +
        `restore its marker or resolve it manually before restart`,
    );
  }

  const dataDir = join(dataRoot, "data");
  const entries = await readDirOrNull(dataDir);
  if (entries === null || entries.length === 0) {
    await mkdir(dataDir, { recursive: true });
    await writeMarker(markerPath, {
      version: LAYOUT_VERSION,
      status: "ready",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const legacy = entries.find((entry) => entry.name === legacyUserId);
  if (legacy === undefined) {
    // Existing content that does not use the one known legacy id is already
    // v2. In particular, data/project/ must remain data/project/.
    await writeMarker(markerPath, {
      version: LAYOUT_VERSION,
      status: "ready",
      completedAt: new Date().toISOString(),
    });
    return;
  }
  if (!legacy.isDirectory()) {
    throw new Error(
      `[persistent-data] expected legacy path ${join(dataDir, legacyUserId)} to be a directory; no files were changed`,
    );
  }

  const others = entries.filter(
    (entry) => entry.name !== legacyUserId && !isIgnorableDataRootEntry(entry),
  );
  if (others.length > 0) {
    throw layoutConflict(dataDir, legacyUserId, others.map((entry) => entry.name));
  }

  const migrating: LayoutMarker = {
    version: LAYOUT_VERSION,
    status: "migrating",
    phase: "prepared",
    legacyUserId,
    startedAt: new Date().toISOString(),
  };
  await writeMarker(markerPath, migrating);
  await runOrResumeMigration(dataRoot, markerPath, migrating);
}
