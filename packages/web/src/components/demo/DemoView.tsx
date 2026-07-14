import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { FileUp, MessageSquare, Pause, Play, RotateCcw, SkipBack, SkipForward, Upload } from "lucide-react";
import type { ChatMessage, TraceNode, WebSocketEvent } from "../../contracts/backend";
import { normalizeWebSocketEvent } from "../../contracts/backend";
import { DemoBundle, DemoFile, MAX_DEMO_BUNDLE_BYTES } from "../../contracts/demoBundle";
import { applyMessageFilters, defaultFilterRules } from "../../contexts/messageFilters";
import { useSandbox } from "../../contexts/SandboxContext";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { downloadBlob } from "../../utils/download";
import { MessageStream } from "../chat/MessageStream";
import { FilePreviewView, PreviewSource } from "../files/FilePreviewView";
import { getPreviewKind, isMarkdown } from "../files/filePreview";
import { IconButton } from "../primitives/IconButton";
import { TraceGraphView } from "../session/TraceGraphView";
import { getNodeKindLabelKey } from "../session/traceLayout";
import { buildDemoBundle, DemoBundleTooLargeError, PackAbortedError, parseDemoBundle } from "./demoBundle";
import { getCachedBundle, setCachedBundle } from "./demoCache";
import { shouldResetDemo } from "./demoReset";
import { foldUpTo, type FoldCache } from "./foldCache";
import {
  DEMO_DEFAULT_CHAT,
  DEMO_DEFAULT_RIGHT,
  loadDemoWidths,
  proposedWidthForEdge,
  resolveDemoResize,
  saveDemoWidths,
  type DemoEdge,
} from "./demoLayout";
import { computeNodeMs } from "./nodeTimeline";
import { DemoFileTree } from "./DemoFileTree";
import { TraceNodeModal } from "./TraceNodeModal";

const TICK_MS = 60;
/** Full timeline plays in this many ms at 1× regardless of real span. */
const FULL_PLAY_MS = 8000;
const SPEEDS = [1, 2, 4, 8];

type DecodedFile = { source: PreviewSource; objectUrl?: string };

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * Keep the user-facing dialogue backbone for the demo's left panel.
 *
 * This is a multi-agent system. The demo bundle captures *all* raw events, and
 * the live Chat (PromptComposer) does NOT collapse the transcript to the
 * principal — it renders every agent's substantive replies, plus error and
 * system_message bubbles, with per-agent attribution. The demo must mirror that
 * so the replay faithfully represents what the user saw: a librarian's progress
 * reply or an expert's error alert is first-class conversation, not internal
 * noise (issue #98).
 *
 * Keep: user prompts; assistant/system plain-text replies from ANY agent;
 * error and system_message bubbles (the agent-attributed warnings/alerts the
 * live Chat shows), plus answered ask_user cards (the question + the user's
 * answer are a user-facing decision point, issue #132 — AskUserCard is a
 * read-only record since #272). Drop: reasoning, tool
 * calls/results, hook diagnostics, the auto_retry card and UNANSWERED ask_user
 * prompts (no meaning in a read-only replay), plus NO-RENDER placeholders and
 * empties.
 */
export function isDemoConversational(m: ChatMessage): boolean {
  if (m.role === "user") {
    return !!m.content?.trim();
  }
  // Answered ask_user: keep as a read-only Q&A step. Unanswered prompts have no
  // meaning in a replay and are dropped.
  if (m.kind === "ask_user") {
    return m.askUser?.answer !== undefined;
  }
  // Agent-attributed warnings/errors the live Chat surfaces as standalone
  // bubbles. system_message carries its own payload; error carries content.
  if (m.kind === "system_message") {
    return !!m.systemMessage;
  }
  if (m.kind === "error") {
    return !!m.content?.trim();
  }
  // Substantive text replies from ANY agent (principal or expert). MessageStream
  // attributes each row by `agent`, so non-principal messages render with their
  // own avatar/name. Missing agent → treated as principal downstream.
  const isPlainText = m.kind === "text" || m.kind === undefined;
  return isPlainText && !!m.content?.trim();
}

const REPORT_NAME = /report|summary|总结|conclusion|readme/i;

/** Pick a sensible default file to show first: prefer report/summary-type. */
function pickDefaultFile(files: DemoFile[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const usable = files.filter((f) => !f.truncated);
  const pool = usable.length > 0 ? usable : files;
  const byName = pool.find((f) => REPORT_NAME.test(basename(f.path)));
  if (byName) {
    return byName.path;
  }
  const md = pool.find((f) => isMarkdown(f.path));
  if (md) {
    return md.path;
  }
  return pool[0].path;
}


export interface DemoViewProps {
  /**
   * Monotonic counter bumped by the shell each time the sidebar "Live Demo"
   * entry is clicked. A *change* (not the initial value) returns the player to
   * the session-selection / import landing — the same effect as the header
   * "Reselect" button — so re-clicking the nav item while a demo is already
   * open isn't a dead no-op (issue #111). Optional so standalone/test mounts
   * work without it.
   */
  resetSignal?: number;
}

export function DemoView({ resetSignal }: DemoViewProps = {}) {
  const t = useT();
  const { sessions, currentSession, messages } = useSessions();
  const { currentSandbox } = useSandbox();

  const [bundle, setBundle] = useState<DemoBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [cursor, setCursor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pinnedFile, setPinnedFile] = useState<string | null>(null);
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  // Draggable column widths (px), restored from localStorage. The middle preview
  // absorbs the remaining space, so only the dragged boundary moves. See
  // demoLayout.ts for geometry + persistence.
  const [chatWidth, setChatWidth] = useState(() => loadDemoWidths().chat);
  const [rightWidth, setRightWidth] = useState(() => loadDemoWidths().right);
  const [isResizing, setIsResizing] = useState(false);
  const formatNodeKind = (kind: string) => {
    const key = getNodeKindLabelKey(kind);
    return key ? t(key) : kind;
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  // Active column drag: which edge, the pointer's start X, and the panel widths
  // at drag start. Null when no drag is in progress.
  const resizeRef = useRef<{ edge: DemoEdge; pointerX: number; chat: number; right: number } | null>(null);
  // Incremental fold cache for timestamped replay (see foldCache.ts).
  const foldCacheRef = useRef<FoldCache | null>(null);
  // Aborts an in-flight pack when the user navigates away / re-selects / the
  // component unmounts, so a slow buildDemoBundle can't resolve into a stale or
  // unmounted view.
  const packAbortRef = useRef<AbortController | null>(null);

  // Decode embedded files into preview sources (lazy blob URLs for binaries).
  // Pure builder: it must NOT revoke prior URLs here — a useMemo factory can run
  // for a render React later discards (concurrent rendering), which would revoke
  // URLs the currently-committed render still points at, breaking image/PDF
  // previews. Revocation happens in the effect below, keyed on the map identity.
  const decoded = useMemo(() => {
    const map = new Map<string, DecodedFile>();
    for (const file of bundle?.files ?? []) {
      if (file.truncated || file.data === undefined) {
        map.set(file.path, {
          source: file.reason === "unreadable"
            ? { kind: "unreadable", detail: file.detail }
            : { kind: "tooLarge" },
        });
        continue;
      }
      const kind = getPreviewKind(basename(file.path));
      if (kind === "text") {
        map.set(file.path, { source: { kind: "text", text: file.data } });
      } else if (kind === "image" || kind === "pdf") {
        const url = URL.createObjectURL(base64ToBlob(file.data, file.mime));
        map.set(file.path, { source: { kind, blobUrl: url }, objectUrl: url });
      } else {
        map.set(file.path, { source: { kind: "download" } });
      }
    }
    return map;
  }, [bundle]);

  // Revoke the *previous* map's blob URLs only after a new decoded map has been
  // committed (and on unmount). Keying the cleanup on `decoded` guarantees we
  // never revoke URLs the live render still references.
  useEffect(() => () => {
    decoded.forEach((d) => d.objectUrl && URL.revokeObjectURL(d.objectUrl));
  }, [decoded]);

  const nodes = bundle?.trace.nodes ?? [];

  // Build the master timeline (ms). Timestamped bundles use real event/node
  // times; ordered (fallback) bundles synthesize an index-based timeline.
  const timeline = useMemo(() => {
    if (!bundle) {
      return { t0: 0, t1: 1, sorted: [] as { ev: WebSocketEvent; ms: number }[], nodeMs: [] as number[], ordered: [] as ChatMessage[] };
    }
    if (bundle.timeline === "timestamped") {
      let last = 0;
      const sorted = [...(bundle.events ?? [])]
        .map((ev) => {
          // Bundles produced by the real backend store raw snake_case events
          // (agent_name, message_id). The live path camelizes via SSEContext
          // before reducing; mirror that here so the reducer sees agentName /
          // messageId and agent attribution survives the replay. camelizeKey is
          // a no-op on already-camelCase keys (e.g. mock bundles), so this is
          // safe for both shapes.
          const normalized = normalizeWebSocketEvent(ev) as WebSocketEvent;
          const parsed = normalized._ts ? Date.parse(String(normalized._ts)) : NaN;
          const ms = Number.isFinite(parsed) ? parsed : last;
          last = ms;
          return { ev: normalized, ms };
        })
        .sort((a, b) => a.ms - b.ms);
      // `ms` is always finite (falls back to the previous value above) and the
      // list is sorted ascending, so the endpoints are the min/max. Read them
      // directly instead of spreading into Math.min/Math.max, which throws
      // RangeError once the event count exceeds the engine's argument limit
      // (large sessions packed with `limit: 0`).
      const t0 = sorted.length ? sorted[0].ms : 0;
      const t1 = sorted.length ? sorted[sorted.length - 1].ms : 1;
      // Reveal nodes at their real times when those are trustworthy (finite,
      // non-decreasing in array order, spanning a real range) so the graph tracks
      // the conversation panel; otherwise fall back to even spacing. computeNodeMs
      // always returns a non-decreasing series, which the filter-≤-cursor / slice
      // reveal relies on. (see nodeTimeline.ts)
      const nodeMs = computeNodeMs(nodes, t0, t1);
      return { t0, t1: t1 > t0 ? t1 : t0 + 1, sorted, nodeMs, ordered: [] as ChatMessage[] };
    }
    const ordered = bundle.messages ?? [];
    const t1 = Math.max(1, ordered.length - 1, nodes.length - 1);
    const nodeMs = nodes.map((_, j) => (nodes.length <= 1 ? 0 : (j / (nodes.length - 1)) * t1));
    return { t0: 0, t1, sorted: [], nodeMs, ordered };
  }, [bundle, nodes]);

  // Return to the landing when the shell signals a sidebar "Live Demo" re-click
  // (issue #111). Fires only on a *change* of resetSignal, never on the initial
  // mount, so importing/packing a bundle isn't immediately undone. Clearing the
  // bundle is enough — the "reset transport on new bundle" effect below re-inits
  // cursor/zoom/etc. the next time a bundle is selected. The module-level
  // demoCache keeps re-opening the same session instant.
  const prevResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (shouldResetDemo(prevResetSignal.current, resetSignal)) {
      prevResetSignal.current = resetSignal;
      // Cancel any pack in flight so it can't resolve into the landing we just
      // returned to.
      packAbortRef.current?.abort();
      setBundle(null);
      setError(null);
    }
  }, [resetSignal]);

  // Abort an in-flight pack if the component unmounts mid-build.
  useEffect(() => () => packAbortRef.current?.abort(), []);

  // Column-resize drag. Listeners live on window so the pointer can leave the
  // thin handle mid-drag; resolveDemoResize owns the clamping (pure + unit-tested
  // in demoLayout.test.ts). Registered once — reads live state via resizeRef.
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) {
        return;
      }
      const container = layoutRef.current?.getBoundingClientRect().width ?? 0;
      const delta = event.clientX - drag.pointerX;
      if (drag.edge === "chat") {
        const proposed = proposedWidthForEdge("chat", drag.chat, delta);
        setChatWidth(resolveDemoResize(proposed, drag.right, container));
      } else {
        const proposed = proposedWidthForEdge("right", drag.right, delta);
        setRightWidth(resolveDemoResize(proposed, drag.chat, container));
      }
    };
    const handlePointerUp = () => {
      if (!resizeRef.current) {
        return;
      }
      resizeRef.current = null;
      setIsResizing(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const startResize = (edge: DemoEdge, event: ReactPointerEvent) => {
    event.preventDefault();
    resizeRef.current = { edge, pointerX: event.clientX, chat: chatWidth, right: rightWidth };
    setIsResizing(true);
  };

  // Double-click a divider to restore that panel's default width.
  const resetEdge = (edge: DemoEdge) => {
    if (edge === "chat") {
      setChatWidth(DEMO_DEFAULT_CHAT);
    } else {
      setRightWidth(DEMO_DEFAULT_RIGHT);
    }
  };

  // Persist widths across sessions. Debounced by the transition into idle: we
  // only write when a drag isn't in progress, so a drag stores once on release
  // (and a double-click reset stores immediately) rather than on every frame.
  useEffect(() => {
    if (isResizing) {
      return;
    }
    saveDemoWidths({ chat: chatWidth, right: rightWidth });
  }, [chatWidth, rightWidth, isResizing]);

  // Reset transport on new bundle (start fully revealed, paused, default file).
  useEffect(() => {
    if (!bundle) {
      return;
    }
    setCursor(timeline.t1);
    setIsPlaying(false);
    setSelectedNodeId(null);
    setModalNodeId(null);
    setPinnedFile(pickDefaultFile(bundle.files));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  // Play loop.
  useEffect(() => {
    if (!isPlaying || !bundle) {
      return;
    }
    const span = timeline.t1 - timeline.t0;
    const perTick = (span * TICK_MS) / FULL_PLAY_MS * speed;
    const id = window.setInterval(() => {
      setCursor((current) => {
        const next = current + perTick;
        if (next >= timeline.t1) {
          setIsPlaying(false);
          return timeline.t1;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isPlaying, bundle, timeline, speed]);

  const revealedMessages = useMemo<ChatMessage[]>(() => {
    if (!bundle) {
      return [];
    }
    if (bundle.timeline === "timestamped") {
      // Incremental prefix fold (see foldCache.ts): only the newly-crossed events
      // are folded as the cursor advances, so the play loop stays O(1) per tick
      // instead of re-folding the whole event log every TICK_MS. Correct even if
      // React double-invokes this memo under concurrent rendering — the cache
      // always holds a real event prefix, so a repeat call just resumes from it.
      const { messages, cache } = foldUpTo(timeline.sorted, cursor, foldCacheRef.current);
      foldCacheRef.current = cache;
      return messages;
    }
    const count = Math.max(0, Math.min(timeline.ordered.length, Math.floor(cursor) + 1));
    return timeline.ordered.slice(0, count);
  }, [bundle, timeline, cursor]);

  // The left panel shows the conversation backbone — the actual dialogue across
  // every agent: the seed prompt, each agent's substantive text replies, and the
  // error/system_message bubbles the live Chat surfaces. Reasoning, tool calls,
  // tool results, hook notes and empty placeholders are dropped (the reasoning
  // graph on the right tells that story). `applyMessageFilters` mirrors the live
  // Chat's default rules (e.g. hiding spurious single-dot messages) so the
  // replay matches what the user actually saw. This is deliberately a content
  // predicate, not a pin-to-two-messages filter: the latter relied on exact
  // id-matching across two independent event folds and silently emptied the
  // panel whenever a MESSAGES_SNAPSHOT reshuffled ids or no clean seed/summary
  // message existed.
  const condensedMessages = useMemo<ChatMessage[]>(
    () => applyMessageFilters(revealedMessages.filter(isDemoConversational), defaultFilterRules),
    [revealedMessages],
  );

  const revealedNodes = useMemo<TraceNode[]>(() => {
    const count = timeline.nodeMs.filter((ms) => ms <= cursor).length;
    const slice = nodes.slice(0, count);
    const visibleIds = new Set(slice.map((n) => n.id));
    return slice.map((node) => ({
      ...node,
      parentIds: node.parentIds.filter((id) => visibleIds.has(id)),
      parents: node.parents.filter((p) => visibleIds.has(p.id)),
      childIds: node.childIds.filter((id) => visibleIds.has(id)),
    }));
  }, [nodes, timeline, cursor]);

  const selectedNode = useMemo<TraceNode | null>(() => {
    if (revealedNodes.length === 0) {
      return null;
    }
    return revealedNodes.find((n) => n.id === selectedNodeId) ?? revealedNodes[revealedNodes.length - 1];
  }, [revealedNodes, selectedNodeId]);

  // Files the currently-selected node produced — highlighted in the file tree.
  const highlightedPaths = useMemo<Set<string>>(
    () => new Set((selectedNode?.artifacts ?? []).map((a) => a.path)),
    [selectedNode],
  );

  // Which file the middle preview shows: explicit pin > latest produced artifact
  // up to the cursor > the report/summary default.
  const currentArtifactPath = useMemo<string | null>(() => {
    if (pinnedFile) {
      return pinnedFile;
    }
    for (let i = revealedNodes.length - 1; i >= 0; i -= 1) {
      const artifact = revealedNodes[i].artifacts?.[0];
      if (artifact?.path) {
        return artifact.path;
      }
    }
    return pickDefaultFile(bundle?.files ?? []);
  }, [revealedNodes, pinnedFile, bundle]);

  const previewFile = bundle?.files.find((f) => f.path === currentArtifactPath) ?? null;
  // A produced artifact may be referenced by the trace but never collected into
  // `bundle.files` (e.g. a directory, or a path the packer skipped). In that case
  // there is no decoded entry — report it as "missing", not "tooLarge", which
  // would be a misleading size claim about a file we simply don't have.
  const previewSource: PreviewSource | null = currentArtifactPath
    ? decoded.get(currentArtifactPath)?.source ?? { kind: "missing" }
    : null;

  const modalNode = useMemo<TraceNode | null>(
    () => (modalNodeId ? nodes.find((n) => n.id === modalNodeId) ?? null : null),
    [modalNodeId, nodes],
  );

  // ----- Transport -----
  const stepIndex = revealedNodes.length; // # nodes revealed at the cursor

  const togglePlay = () => {
    if (!bundle) {
      return;
    }
    if (cursor >= timeline.t1) {
      setCursor(timeline.t0);
    }
    setPinnedFile(null);
    setIsPlaying((p) => !p);
  };

  const restart = () => {
    setIsPlaying(false);
    setPinnedFile(null);
    setCursor(timeline.t0);
  };

  const stepTo = (nodeIdx: number) => {
    // Reveal nodes [0..nodeIdx]; cursor lands on that node's time.
    setIsPlaying(false);
    setPinnedFile(null);
    if (nodeIdx < 0) {
      setCursor(timeline.t0);
    } else {
      setCursor(timeline.nodeMs[nodeIdx] ?? timeline.t1);
    }
    const node = nodes[Math.max(0, Math.min(nodeIdx, nodes.length - 1))];
    if (node) {
      setSelectedNodeId(node.id);
    }
  };

  const stepNext = () => {
    if (stepIndex >= nodes.length) {
      return;
    }
    stepTo(stepIndex); // reveal one more node
  };

  const stepPrev = () => {
    if (stepIndex <= 1) {
      setCursor(timeline.t0);
      setIsPlaying(false);
      setPinnedFile(null);
      return;
    }
    stepTo(stepIndex - 2);
  };

  const scrub = (value: number) => {
    setIsPlaying(false);
    setPinnedFile(null);
    setCursor(value);
  };

  const selectFile = (path: string) => {
    setPinnedFile(path);
  };

  const onNodeClick = (id: string) => {
    setSelectedNodeId(id);
    setModalNodeId(id);
  };

  const handlePackSession = async (sessionId: string, title: string, updatedAt?: string) => {
    // A running sandbox lets us embed produced files; without one we still pack
    // the conversation, trace and events (all host-persisted) and mark the
    // files unreadable. So the export is never hard-blocked on the sandbox.
    const runningSandbox =
      currentSandbox && currentSandbox.status === "running" ? currentSandbox : null;
    // Page-lifetime cache: re-opening the same (unchanged) session is instant
    // and issues no requests. But a bundle packed without a sandbox recorded all
    // produced files as unreadable; if a sandbox is now running we must re-pack
    // to embed the real bytes instead of serving that stale file-less bundle.
    const cached = getCachedBundle(sessionId, updatedAt);
    if (cached && !(runningSandbox && cached.packedWithSandbox === false)) {
      setError(null);
      setBundle(cached);
      return;
    }
    // Cancel any earlier in-flight pack and start a fresh one.
    packAbortRef.current?.abort();
    const controller = new AbortController();
    packAbortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress(t("demo.packing"));
    try {
      const built = await buildDemoBundle({
        session: {
          id: sessionId,
          title,
          createdAt: currentSession?.id === sessionId ? currentSession.createdAt : undefined,
          updatedAt: updatedAt ?? (currentSession?.id === sessionId ? currentSession.updatedAt : undefined),
        },
        // File routes are session-addressed in both local and hosted mode. The
        // sandbox object only tells the packer whether file access is live.
        filesAvailable: !!runningSandbox,
        filesUnavailableDetail: runningSandbox ? undefined : t("demo.files.noSandbox"),
        fallbackMessages: currentSession?.id === sessionId ? messages : undefined,
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      setCachedBundle(sessionId, updatedAt, built);
      setBundle(built);
    } catch (err) {
      // A cancelled pack is expected (navigated away / re-selected) — not an error.
      if (err instanceof PackAbortedError || controller.signal.aborted) {
        return;
      }
      setError(
        err instanceof DemoBundleTooLargeError
          ? t("demo.error.tooLarge", { size: Math.floor(MAX_DEMO_BUNDLE_BYTES / 1024 / 1024) })
          : err instanceof Error
            ? err.message
            : t("demo.error.build"),
      );
    } finally {
      if (packAbortRef.current === controller) {
        packAbortRef.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  };

  const handleImportFile = async (file: File) => {
    // Importing supersedes any pack still in flight.
    packAbortRef.current?.abort();
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_DEMO_BUNDLE_BYTES) {
        throw new Error(t("demo.error.tooLarge", { size: Math.floor(MAX_DEMO_BUNDLE_BYTES / 1024 / 1024) }));
      }
      const parsed = parseDemoBundle(await file.text());
      setBundle(parsed);
    } catch (err) {
      setError(
        err instanceof DemoBundleTooLargeError
          ? t("demo.error.tooLarge", { size: Math.floor(MAX_DEMO_BUNDLE_BYTES / 1024 / 1024) })
          : err instanceof Error
            ? err.message
            : t("demo.error.parse"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) {
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleImportFile(file);
    }
  };

  const handleExport = () => {
    if (!bundle) {
      return;
    }
    if (!window.confirm(t("demo.exportConfirm"))) {
      return;
    }
    const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
    downloadBlob(blob, `${bundle.session.title || "session"}-demo.json`);
  };

  // ----- Landing -----
  if (!bundle) {
    return (
      <main className="demo-view" aria-label={t("demo.title")}>
        <div className="demo-landing">
          <header className="demo-landing__header">
            <span className="workspace-panel__eyebrow">{t("demo.eyebrow")}</span>
            <h1>{t("demo.landing.heading")}</h1>
            <p>{t("demo.landing.subtitle")}</p>
          </header>
          {error ? <p className="demo-landing__error">{error}</p> : null}
          <div className="demo-landing__cards">
            <section className="demo-card">
              <div className="demo-card__head">
                <MessageSquare size={16} />
                <h2>{t("demo.landing.fromSession.title")}</h2>
              </div>
              <p>{t("demo.landing.fromSession.desc")}</p>
              <p className="demo-card__privacy">{t("demo.privacyNotice")}</p>
              <div className="demo-card__sessions">
                {sessions.length === 0 ? (
                  <p className="demo-card__empty">{t("demo.landing.fromSession.empty")}</p>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      className="demo-session-row"
                      disabled={busy}
                      onClick={() => void handlePackSession(session.id, session.title, session.updatedAt)}
                      type="button"
                    >
                      <span>{session.title}</span>
                      <small>{new Date(session.updatedAt).toLocaleDateString()}</small>
                    </button>
                  ))
                )}
              </div>
            </section>
            <section className="demo-card">
              <div className="demo-card__head">
                <FileUp size={16} />
                <h2>{t("demo.landing.import.title")}</h2>
              </div>
              <p>{t("demo.landing.import.desc")}</p>
              <button
                className={`demo-dropzone ${dragOver ? "is-dragover" : ""}`}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy) {
                    setDragOver(true);
                  }
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                type="button"
              >
                <Upload size={20} className="demo-dropzone__icon" />
                <span className="demo-dropzone__primary">{t("demo.landing.import.button")}</span>
                <span className="demo-dropzone__hint">{t("demo.landing.import.dropHint")}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleImportFile(file);
                  }
                  e.target.value = "";
                }}
              />
            </section>
          </div>
          {busy ? <p className="demo-landing__progress">{progress || t("demo.packing")}</p> : null}
        </div>
      </main>
    );
  }

  // ----- Player -----
  // Prefer the authoritative title from the live session list (it tracks
  // backend `session_title` updates) over the snapshot captured into the bundle
  // at pack time, which can be stale (e.g. "Session f8f35032" before a reload).
  // Falls back to the bundle title for imported bundles whose source session is
  // not in this client's list.
  const liveSession = sessions.find((s) => s.id === bundle.session.id);
  const displayTitle = liveSession?.title || bundle.session.title;
  return (
    <main className="demo-view" aria-label={t("demo.title")}>
      <header className="demo-header">
        <div className="demo-header__title">
          <span className="workspace-panel__eyebrow">{t("demo.eyebrow")}</span>
          <h1>{displayTitle}</h1>
          <span className="demo-header__meta">
            {t("demo.meta.exported", { time: new Date(bundle.exportedAt).toLocaleString() })}
          </span>
        </div>
        <div className="demo-header__actions">
          <button className="demo-export" onClick={handleExport} type="button">
            <Upload size={14} />
            <span>{t("demo.exportButton")}</span>
          </button>
          <button className="demo-reselect" onClick={() => setBundle(null)} type="button">
            {t("demo.reselect")}
          </button>
        </div>
      </header>

      <div
        ref={layoutRef}
        className={`demo-layout ${isResizing ? "demo-layout--resizing" : ""}`}
        style={{ "--demo-chat-width": `${chatWidth}px`, "--demo-right-width": `${rightWidth}px` } as CSSProperties}
      >
        <section className="demo-panel demo-panel--chat">
          <header className="demo-panel__head">
            <h2>{t("demo.conversation.title")}</h2>
          </header>
          {condensedMessages.length === 0 ? (
            <p className="demo-panel__empty">{t("demo.conversation.empty")}</p>
          ) : (
            <MessageStream messages={condensedMessages} showToolbarCount={false} groupExpertActivity className="demo-message-stream" />
          )}
        </section>

        <div
          className="demo-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("demo.resize.chat")}
          title={t("demo.resize.reset")}
          onPointerDown={(e) => startResize("chat", e)}
          onDoubleClick={() => resetEdge("chat")}
        />

        <section className="demo-panel demo-panel--preview">
          <header className="demo-panel__head demo-preview-head">
            <h2>{t("demo.files.title")}</h2>
            {previewFile ? (
              <span className="demo-preview-name" title={previewFile.path}>
                {basename(previewFile.path)}
                {previewFile.truncated ? <small> · {t("demo.files.skipped")}</small> : null}
              </span>
            ) : null}
          </header>
          <div className="demo-preview-body">
            {previewSource && previewFile ? (
              <FilePreviewView
                name={basename(previewFile.path)}
                source={previewSource}
                renderMarkdown={isMarkdown(previewFile.path)}
                t={t}
              />
            ) : (
              <p className="demo-panel__empty">{bundle.files.length === 0 ? t("demo.files.empty") : t("demo.files.none")}</p>
            )}
          </div>
        </section>

        <div
          className="demo-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("demo.resize.right")}
          title={t("demo.resize.reset")}
          onPointerDown={(e) => startResize("right", e)}
          onDoubleClick={() => resetEdge("right")}
        />

        <div className="demo-right">
          <section className="demo-panel demo-panel--trace">
            <header className="demo-panel__head">
              <h2>{t("demo.trace.title")}</h2>
            </header>
            <div className="demo-trace-map">
              <TraceGraphView
                nodes={revealedNodes}
                direction="LR"
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={onNodeClick}
                zoom={zoom}
                onZoomChange={setZoom}
                fitToken={revealedNodes.length}
                formatKind={formatNodeKind}
                zoomLabels={{
                  controls: t("trace.aria.zoomControls"),
                  zoomIn: t("trace.aria.zoomIn"),
                  zoomOut: t("trace.aria.zoomOut"),
                  reset: t("trace.aria.resetZoom"),
                }}
              />
            </div>
            <div className="demo-transport">
              <IconButton label={t("demo.transport.prev")} onClick={stepPrev} disabled={stepIndex <= 1}>
                <SkipBack size={14} />
              </IconButton>
              <IconButton
                label={isPlaying ? t("demo.transport.pause") : t("demo.transport.play")}
                onClick={togglePlay}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <IconButton label={t("demo.transport.next")} onClick={stepNext} disabled={stepIndex >= nodes.length}>
                <SkipForward size={14} />
              </IconButton>
              <IconButton label={t("demo.transport.restart")} onClick={restart}>
                <RotateCcw size={13} />
              </IconButton>
              <input
                className="demo-transport__slider"
                type="range"
                min={timeline.t0}
                max={timeline.t1}
                step={(timeline.t1 - timeline.t0) / 1000 || 1}
                value={cursor}
                onChange={(e) => scrub(Number(e.target.value))}
                aria-label={t("demo.transport.play")}
              />
              <span className="demo-transport__step">{t("demo.transport.step", { index: stepIndex, total: nodes.length })}</span>
              <div className="demo-transport__speeds" aria-label={t("demo.transport.speed")}>
                {SPEEDS.map((s) => (
                  <button key={s} className={speed === s ? "is-active" : ""} onClick={() => setSpeed(s)} type="button">
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="demo-panel demo-panel--tree">
            <header className="demo-panel__head">
              <h2>{t("demo.tree.title")}</h2>
            </header>
            <div className="demo-tree-body">
              <DemoFileTree
                files={bundle.files}
                highlightedPaths={highlightedPaths}
                activePath={currentArtifactPath}
                onSelect={selectFile}
                emptyLabel={t("demo.files.empty")}
                skippedLabel={t("demo.files.skipped")}
                unreadableLabel={t("demo.files.unreadable")}
              />
            </div>
          </section>
        </div>
      </div>

      <TraceNodeModal
        node={modalNode}
        onClose={() => setModalNodeId(null)}
        onSelectNode={(id) => { setSelectedNodeId(id); setModalNodeId(id); }}
        nodes={nodes}
        onSelectArtifact={selectFile}
        activeArtifactPath={currentArtifactPath}
        closeLabel={t("demo.node.modalClose")}
        formatKind={formatNodeKind}
        t={t}
      />
    </main>
  );
}
