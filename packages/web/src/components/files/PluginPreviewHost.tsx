import { useEffect, useRef, useState } from "react";
import {
  PREVIEW_RPC_VERSION,
  isPreviewPluginMessage,
  type PreviewHostToPluginMessage,
} from "@brainpilot/plugin-sdk/preview";
import { api } from "../../utils/api";
import type { EnabledPreviewer } from "./previewerRegistry";

const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_WHOLE_FILE_BYTES = 50 * 1024 * 1024;

export function PluginPreviewHost({ previewer, sandboxId, path, name, size, onRendered }: {
  previewer: EnabledPreviewer;
  sandboxId: string;
  path: string;
  name: string;
  size: number;
  onRendered?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const tokenRef = useRef(crypto.randomUUID());
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const [status, setStatus] = useState("Loading plugin…");
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    let cancelled = false;
    let delivered = false;
    const handles = new Map<string, string>([["primary", path]]);
    const send = (message: PreviewHostToPluginMessage, transfer: Transferable[] = []) => {
      iframeRef.current?.contentWindow?.postMessage(message, "*", transfer);
    };
    const fail = (cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    };
    const timeout = window.setTimeout(() => {
      if (!delivered && !cancelled) setError("Plugin did not become ready in time.");
    }, 10_000);

    const openRangePreview = async () => {
      const rule = typeof previewer.previewer.match?.dataset === "object"
        ? previewer.previewer.match.dataset
        : undefined;
      let candidates = [{ path, handle: "primary", name }];
      if (rule?.kind === "stem-siblings") {
        const selectedSuffix = rule.companions.find((suffix) => path.toLowerCase().endsWith(suffix.toLowerCase()));
        if (selectedSuffix) {
          const stem = path.slice(0, -selectedSuffix.length);
          candidates = rule.companions.map((suffix, index) => {
            const candidatePath = `${stem}${suffix}`;
            return { path: candidatePath, handle: candidatePath === path ? "primary" : `companion:${index}`, name: candidatePath.split("/").pop()! };
          });
        }
      }
      const resolved = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        info: await api.sandbox.readRawFileRange(sandboxId, candidate.path, 0, 1)
          .catch((cause) => candidate.handle === "primary" ? Promise.reject(cause) : null),
      })));
      const missingRequired = (rule?.required ?? []).find((suffix) =>
        resolved.some(({ candidate, info }) => candidate.path.toLowerCase().endsWith(suffix.toLowerCase()) && info === null),
      );
      if (missingRequired) throw new Error(`Required dataset member is missing: ${missingRequired}`);
      const members = resolved.filter((item) => item.info !== null).map(({ candidate, info }) => {
        handles.set(candidate.handle, candidate.path);
        return { name: candidate.name, size: info!.totalSize, handle: candidate.handle };
      });
      const primary = members.find((member) => member.handle === "primary");
      if (!primary) throw new Error("The selected preview file is unavailable.");
      const buffer = new ArrayBuffer(0);
      const message: PreviewHostToPluginMessage = {
        type: "preview/open",
        rpcVersion: PREVIEW_RPC_VERSION,
        token: tokenRef.current,
        requestId: crypto.randomUUID(),
        file: { name, size: primary.size, handle: "primary" },
        buffer,
        ...(rule ? { dataset: { kind: rule.kind, primaryHandle: "primary", members } } : {}),
      };
      send(message, [buffer]);
    };

    const openWholePreview = async () => {
      if (size > MAX_WHOLE_FILE_BYTES) throw new Error("This whole-file preview exceeds the 50 MiB host limit.");
      const blob = await api.sandbox.readRawFile(sandboxId, path);
      const buffer = await blob.arrayBuffer();
      const message: PreviewHostToPluginMessage = {
        type: "preview/open",
        rpcVersion: PREVIEW_RPC_VERSION,
        token: tokenRef.current,
        requestId: crypto.randomUUID(),
        file: { name, size: buffer.byteLength, mime: blob.type || undefined, handle: "primary" },
        buffer,
      };
      send(message, [buffer]);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isPreviewPluginMessage(event.data) || event.data.token !== tokenRef.current) return;
      const message = event.data;
      if (message.type === "preview/read-range") {
        const sourcePath = handles.get(message.handle);
        if (!sourcePath) {
          send({ type: "preview/range-error", rpcVersion: PREVIEW_RPC_VERSION, token: tokenRef.current, requestId: message.requestId, handle: message.handle, message: "Unknown preview file handle." });
          return;
        }
        const length = Math.min(message.length, MAX_RANGE_BYTES);
        void api.sandbox.readRawFileRange(sandboxId, sourcePath, message.offset, length)
          .then(async ({ blob, offset, totalSize }) => {
            if (cancelled) return;
            const buffer = await blob.arrayBuffer();
            send({ type: "preview/range-result", rpcVersion: PREVIEW_RPC_VERSION, token: tokenRef.current, requestId: message.requestId, handle: message.handle, offset, totalSize, buffer }, [buffer]);
          })
          .catch((cause) => {
            if (!cancelled) send({ type: "preview/range-error", rpcVersion: PREVIEW_RPC_VERSION, token: tokenRef.current, requestId: message.requestId, handle: message.handle, message: cause instanceof Error ? cause.message : String(cause) });
          });
        return;
      }
      if (message.type === "preview/error") setError(message.message);
      if (message.type === "preview/rendered") {
        setStatus("");
        onRenderedRef.current?.();
      }
      if (message.type === "preview/resize") setHeight(Math.max(240, Math.min(1600, message.height)));
      if (message.type !== "preview/ready" || delivered) return;
      delivered = true;
      setStatus("Reading file…");
      void (previewer.previewer.delivery === "range" ? openRangePreview() : openWholePreview()).catch(fail);
    };

    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      send({ type: "preview/dispose", rpcVersion: PREVIEW_RPC_VERSION, token: tokenRef.current });
    };
  }, [name, path, previewer.pluginId, previewer.pluginVersion, previewer.previewer, sandboxId, size]);

  const src = `${api.plugins.previewAssetUrl(previewer.pluginId, previewer.pluginVersion, previewer.previewer.entry)}#${encodeURIComponent(tokenRef.current)}`;
  const initialize = () => {
    const message: PreviewHostToPluginMessage = {
      type: "preview/initialize",
      rpcVersion: PREVIEW_RPC_VERSION,
      token: tokenRef.current,
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  };

  return (
    <div className="plugin-preview-host">
      {error ? <p className="file-preview__notice">{error}</p> : null}
      {!error && status ? <p className="file-preview__notice">{status}</p> : null}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        src={src}
        onLoad={initialize}
        style={{ minHeight: height }}
        title={`${previewer.displayName}: ${name}`}
      />
    </div>
  );
}
