/** Keep Azure Responses history self-contained when Pi sends store:false. */
type JsonObject = Record<string, unknown>;

function record(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Remove response IDs that refer to server state Azure did not persist. */
export function normalizeAzureStatelessPayload(payload: unknown): unknown {
  if (!record(payload) || payload.store !== false || !Array.isArray(payload.input)) return payload;
  let changed = false;
  const input = payload.input.flatMap((entry: unknown) => {
    if (!record(entry)) return [entry];
    if (entry.type === "reasoning") {
      if (!entry.encrypted_content) {
        changed = true;
        return [];
      }
      if (typeof entry.id === "string") {
        changed = true;
        const { id: _id, ...rest } = entry;
        return [rest];
      }
    }
    if (entry.type === "function_call" && typeof entry.id === "string") {
      changed = true;
      const { id: _id, ...rest } = entry;
      return [rest];
    }
    return [entry];
  });
  return changed ? { ...payload, input } : payload;
}

interface ProviderRequestApi {
  on(
    event: "before_provider_request",
    handler: (event: { payload: unknown }, context: { model?: { api?: string } }) => unknown,
  ): void;
}

export function makeAzureResponsesStatelessExt(): (pi: ProviderRequestApi) => void {
  return (pi) => {
    pi.on("before_provider_request", (event, context) => {
      if (context.model?.api !== "azure-openai-responses") return undefined;
      return normalizeAzureStatelessPayload(event.payload);
    });
  };
}
