export const PREVIEW_RPC_VERSION = "1" as const;

export interface PreviewDatasetRule {
  kind: "stem-siblings";
  companions: string[];
  required?: string[];
}

export interface PreviewerMatch {
  extensions?: string[];
  mimeTypes?: string[];
  dataset?: string | PreviewDatasetRule;
}

export interface PreviewerContribution {
  id: string;
  match?: PreviewerMatch;
  /** Legacy v0 form; normalized into match.extensions by parsePluginManifest. */
  extensions?: string[];
  priority?: number;
  mode?: "readonly" | "editable";
  delivery?: "whole" | "range" | "derived";
  entry: string;
}

export interface EnabledPreviewer {
  pluginId: string;
  pluginVersion: string;
  displayName: string;
  previewer: PreviewerContribution;
}

export interface PreviewFileDescriptor {
  name: string;
  size: number;
  mime?: string;
  handle?: string;
}

export interface PreviewCompanionFile extends PreviewFileDescriptor { buffer?: ArrayBuffer; }
export interface PreviewDatasetDescriptor { kind: string; primaryHandle: string; members: PreviewFileDescriptor[]; }

export type PreviewHostToPluginMessage =
  | { type: "preview/initialize"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; theme?: "light" | "dark" }
  | { type: "preview/open"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; file: PreviewFileDescriptor; buffer: ArrayBuffer; companions?: PreviewCompanionFile[]; dataset?: PreviewDatasetDescriptor; derived?: unknown }
  | { type: "preview/range-result"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; handle: string; offset: number; totalSize: number; buffer: ArrayBuffer }
  | { type: "preview/range-error"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; handle: string; message: string }
  | { type: "preview/dispose"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string };

export type PreviewPluginToHostMessage =
  | { type: "preview/ready"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string }
  | { type: "preview/rendered"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; metadata?: Record<string, unknown> }
  | { type: "preview/error"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId?: string; message: string }
  | { type: "preview/resize"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; height: number }
  | { type: "preview/read-range"; rpcVersion: typeof PREVIEW_RPC_VERSION; token: string; requestId: string; handle: string; offset: number; length: number };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function previewerExtensions(value: PreviewerContribution): string[] {
  return value.match?.extensions ?? value.extensions ?? [];
}

export function isPreviewPluginMessage(value: unknown): value is PreviewPluginToHostMessage {
  if (!object(value) || value.rpcVersion !== PREVIEW_RPC_VERSION || typeof value.token !== "string" || typeof value.type !== "string") return false;
  if (value.type === "preview/read-range") return typeof value.requestId === "string" && typeof value.handle === "string" && typeof value.offset === "number" && value.offset >= 0 && typeof value.length === "number" && value.length > 0;
  return value.type === "preview/ready" || value.type === "preview/rendered" || value.type === "preview/error" || value.type === "preview/resize";
}

