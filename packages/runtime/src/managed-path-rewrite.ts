/**
 * #346 — logical managed-path rewrite for Pi file tools.
 *
 * The HTTP Files API maps logical prefixes (`/workspace`, `/data`, …) onto the
 * durable volume via SessionManager.resolveManagedPath. Pi's built-in write/
 * edit/bash tools do NOT: absolute `/workspace` lands on the container
 * writable layer and vanishes on idle docker stop.
 *
 * These pure helpers mirror resolveManagedPath for agent tool args so the two
 * channels agree. Wired through the managed-path-guard Pi extension.
 */
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export interface ManagedPathRoots {
  /** Session workspace (agent cwd): `<dataRoot>/workspaces/<sid>/`. */
  cwd: string;
  /** Persistent cross-session library: `<dataRoot>/data/`. */
  persistentDir: string;
  /** Optional cross-user read-only shared root (`BP_SHARED_DIR`). */
  sharedDir?: string;
  /** Hidden attachments subdir name under cwd. Default `.attachments`. */
  attachmentsDirname?: string;
}

export type ManagedRootKind = "workspace" | "data" | "attachments" | "shared" | "other";

export type RewriteOk = {
  ok: true;
  /** Path to put back into the tool arg (relative under cwd when possible). */
  path: string;
  rewritten: boolean;
  root: ManagedRootKind;
  /** Absolute resolved path (for confinement checks). */
  abs: string;
};

export type RewriteErr = { ok: false; error: string };

export type RewriteResult = RewriteOk | RewriteErr;

const ATTACHMENTS_DEFAULT = ".attachments";

/** Stable deny message when a write/edit targets non-durable storage. */
export function denyEphemeralWriteReason(rawPath: string): string {
  return (
    `Refusing write outside durable storage (${rawPath}). ` +
    `Use a relative path (cwd is the session workspace) or the persistent library path. ` +
    `Absolute /workspace is rewritten to the session workspace; other container paths ` +
    `are not persisted across sandbox recycle.`
  );
}

export function denySharedWriteReason(rawPath: string): string {
  return `shared root is read-only: ${rawPath}`;
}

export function denyPathEscapeReason(label: string, rawPath: string): string {
  return `path escapes ${label}: ${rawPath}`;
}

/** True when `abs` is exactly `root` or a path under it (segment boundary). */
export function isUnderRoot(abs: string, root: string): boolean {
  if (!abs || !root) return false;
  const base = normalize(resolve(root));
  const target = normalize(resolve(abs));
  if (target === base) return true;
  const prefix = base.endsWith(sep) ? base : base + sep;
  return target.startsWith(prefix);
}

function posixJoinRoot(rootAbs: string, rel: string): string {
  const clean = rel.replace(/^\/+/, "");
  return clean ? resolve(rootAbs, clean) : resolve(rootAbs);
}

/**
 * Prefer a cwd-relative path when the target lives under the session workspace
 * (cleaner tool results; teaches the model to stay relative). Otherwise return
 * the absolute path (persistent / shared roots match persona-injected abs paths).
 */
function displayPath(abs: string, roots: ManagedPathRoots, kind: ManagedRootKind): string {
  if (kind === "workspace" || kind === "attachments") {
    const rel = relative(resolve(roots.cwd), abs);
    if (rel === "") return ".";
    // relative() can still produce `..` escapes on weird inputs; fall back to abs.
    if (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) {
      return rel.split(sep).join("/");
    }
  }
  return abs;
}

function classifyAbs(abs: string, roots: ManagedPathRoots): ManagedRootKind {
  if (isUnderRoot(abs, roots.cwd)) {
    const att = resolve(roots.cwd, roots.attachmentsDirname ?? ATTACHMENTS_DEFAULT);
    if (isUnderRoot(abs, att)) return "attachments";
    return "workspace";
  }
  if (isUnderRoot(abs, roots.persistentDir)) return "data";
  if (roots.sharedDir && isUnderRoot(abs, roots.sharedDir)) return "shared";
  return "other";
}

/**
 * Rewrite a tool path argument that uses a logical managed prefix onto the
 * real durable root. Non-logical paths (relative or real abs) pass through
 * unchanged (still classified for confinement).
 */
export function rewriteLogicalPath(raw: string, roots: ManagedPathRoots): RewriteResult {
  if (typeof raw !== "string") {
    return { ok: false, error: denyPathEscapeReason("workspace", String(raw)) };
  }
  const original = raw;
  // Cross-platform: accept `\` the way resolveManagedPath does.
  let p = raw.replace(/\\/g, "/").trim();
  if (!p) {
    return {
      ok: true,
      path: original,
      rewritten: false,
      root: "other",
      abs: resolve(roots.cwd),
    };
  }

  const cwdAbs = resolve(roots.cwd);
  const dataAbs = resolve(roots.persistentDir);
  const attName = roots.attachmentsDirname ?? ATTACHMENTS_DEFAULT;
  const attAbs = resolve(cwdAbs, attName);

  // A deployment may mount the whole BrainPilot data root at `/data`, making
  // the real session cwd `/data/workspaces/<sid>` and the real persistent
  // library `/data/data`. Those physical paths must win over the logical
  // `/data` alias or an already-resolved path is rewritten a second time (for
  // example `/data/data/x` -> `/data/data/data/x`). Relative paths and absolute
  // paths outside known durable roots still flow through the logical-prefix
  // handling below.
  if (isAbsolute(p)) {
    const abs = normalize(resolve(p));
    const classified = classifyAbs(abs, roots);
    if (classified !== "other") {
      return {
        ok: true,
        path: p,
        rewritten: false,
        root: classified,
        abs,
      };
    }
  }

  let rootAbs: string;
  let kind: ManagedRootKind;
  let rel: string;
  let logical = false;

  if (p === "/data" || p.startsWith("/data/")) {
    rootAbs = dataAbs;
    kind = "data";
    rel = p === "/data" ? "" : p.slice("/data/".length);
    logical = true;
  } else if (p === "/attachments" || p.startsWith("/attachments/")) {
    rootAbs = attAbs;
    kind = "attachments";
    rel = p === "/attachments" ? "" : p.slice("/attachments/".length);
    logical = true;
  } else if (roots.sharedDir && (p === "/shared" || p.startsWith("/shared/"))) {
    rootAbs = resolve(roots.sharedDir);
    kind = "shared";
    rel = p === "/shared" ? "" : p.slice("/shared/".length);
    logical = true;
  } else if (p === "/workspace" || p.startsWith("/workspace/")) {
    rootAbs = cwdAbs;
    kind = "workspace";
    rel = p === "/workspace" ? "" : p.slice("/workspace/".length);
    logical = true;
  } else {
    const abs = normalize(isAbsolute(p) ? resolve(p) : resolve(cwdAbs, p));
    const classified = classifyAbs(abs, roots);
    return {
      ok: true,
      path: p,
      rewritten: false,
      root: classified,
      abs,
    };
  }

  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = normalize(posixJoinRoot(rootAbs, rel));
  if (!isUnderRoot(abs, rootAbs)) {
    const label =
      kind === "data"
        ? "data root"
        : kind === "attachments"
          ? "attachments"
          : kind === "shared"
            ? "shared root"
            : "workspace";
    return { ok: false, error: denyPathEscapeReason(label, original) };
  }

  return {
    ok: true,
    path: displayPath(abs, roots, kind),
    rewritten: logical,
    root: kind,
    abs,
  };
}

/**
 * write/edit may only land under the session workspace or the persistent
 * library. The cross-user shared root is read-only (HTTP assertWritable parity).
 * Returns a reason string when denied, or null when allowed.
 */
export function denyWriteOutsideDurable(
  pathOrAbs: string,
  roots: ManagedPathRoots,
  rawForMessage?: string,
): string | null {
  const r = rewriteLogicalPath(pathOrAbs, roots);
  if (!r.ok) return r.error;
  const msgPath = rawForMessage ?? pathOrAbs;
  if (r.root === "shared") return denySharedWriteReason(msgPath);
  if (r.root === "workspace" || r.root === "attachments" || r.root === "data") {
    return null;
  }
  return denyEphemeralWriteReason(msgPath);
}

/**
 * Best-effort rewrite of absolute `/workspace` tokens inside a bash command so
 * `mkdir -p /workspace/foo` and `cd /workspace/foo` land on the session cwd.
 * Not a shell parser — `$var` expansion can still bypass; structured tools are
 * the hard guarantee.
 */
export function rewriteBashWorkspacePaths(
  command: string,
  cwd: string,
): { command: string; rewritten: boolean } {
  if (!command) return { command, rewritten: false };
  const cwdPosix = resolve(cwd).split(sep).join("/");
  // Path-boundary match: do not rewrite `/workspace_backup` or `my/workspace`.
  // Lookbehind-ish via capturing the preceding delimiter.
  let rewritten = false;
  const next = command.replace(
    /(^|[\s"'`=])\/workspace(?=\/|[\s"'`]|$)/g,
    (_m, pre: string) => {
      rewritten = true;
      return `${pre}${cwdPosix}`;
    },
  );
  return { command: next, rewritten };
}

const PATH_KEYS = ["path", "file_path", "filePath"] as const;

/**
 * Apply rewrite (+ write confinement for write/edit) to a Pi tool_call input
 * object in place. Returns `{ block, reason }` when the call must be denied.
 */
export function applyManagedPathToolCall(opts: {
  toolName: string;
  input: Record<string, unknown> | null | undefined;
  roots: ManagedPathRoots;
}): { block: true; reason: string } | void {
  const { toolName, roots } = opts;
  const input = opts.input;
  if (!input || typeof input !== "object") return;

  const name = toolName.toLowerCase();

  if (name === "bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (command) {
      const r = rewriteBashWorkspacePaths(command, roots.cwd);
      if (r.rewritten) input.command = r.command;
    }
    return;
  }

  // Tools that never carry a filesystem path for this guard.
  if (name === "skill_search") return;

  const mutating = name === "write" || name === "edit";

  for (const key of PATH_KEYS) {
    const v = input[key];
    if (typeof v !== "string" || v.trim() === "") continue;
    const raw = v;
    const r = rewriteLogicalPath(raw, roots);
    if (!r.ok) return { block: true, reason: r.error };
    // Confine mutating tools before mutating the arg, so deny messages keep
    // the model-facing path the agent actually sent.
    if (mutating) {
      if (r.root === "shared") {
        return { block: true, reason: denySharedWriteReason(raw) };
      }
      if (r.root === "other") {
        return { block: true, reason: denyEphemeralWriteReason(raw) };
      }
    }
    if (r.rewritten) input[key] = r.path;
  }
}
