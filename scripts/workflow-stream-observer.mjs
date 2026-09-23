// Test-only, read-only SSE metadata observation. Does not alter SDK responses.
const member = (value, allowed) => allowed.includes(value) ? value : undefined;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/u.test(value) ? value : undefined;
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

/** Explicit wire allowlist: never copy messages, schemas, arbitrary options or credentials. */
export function providerRequestMetadata(request) {
  const thinking = request?.thinking;
  const output = request?.output_config;
  const choice = request?.tool_choice;
  return compact({
    model: identifier(request?.model),
    max_tokens: nonnegative(request?.max_tokens),
    thinking: thinking && typeof thinking === 'object' ? compact({
      type: member(thinking.type, ['enabled', 'disabled', 'adaptive']),
      budget_tokens: nonnegative(thinking.budget_tokens),
      display: member(thinking.display, ['summarized', 'omitted']),
    }) : undefined,
    output_config: output && typeof output === 'object' ? compact({
      effort: member(output.effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    }) : undefined,
    tool_choice: typeof choice === 'string' ? member(choice, ['auto', 'none', 'required', 'any'])
      : choice && typeof choice === 'object' ? compact({
        type: member(choice.type, ['auto', 'any', 'none', 'tool', 'function']),
        name: identifier(choice.name ?? choice.function?.name),
        disable_parallel_tool_use: typeof choice.disable_parallel_tool_use === 'boolean' ? choice.disable_parallel_tool_use : undefined,
      }) : undefined,
  });
}

const usageFields = ['input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens',
  'cache_creation_input_tokens', 'cache_read_input_tokens', 'cache_read_tokens', 'cache_write_tokens'];
function usageMetadata(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const result = compact(Object.fromEntries(usageFields.map(key => [key, nonnegative(usage[key])])));
  for (const [key, fields] of Object.entries({
    cache_creation: ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'],
    output_tokens_details: ['thinking_tokens', 'reasoning_tokens'],
    input_tokens_details: ['cached_tokens'],
    prompt_tokens_details: ['cached_tokens'],
    completion_tokens_details: ['reasoning_tokens', 'accepted_prediction_tokens', 'rejected_prediction_tokens'],
  })) {
    const nested = usage[key];
    if (!nested || typeof nested !== 'object') continue;
    const values = compact(Object.fromEntries(fields.map(field => [field, nonnegative(nested[field])])));
    if (Object.keys(values).length) result[key] = values;
  }
  return Object.keys(result).length ? result : undefined;
}
const eventTypes = ['message_start', 'message_delta', 'message_stop', 'content_block_start', 'content_block_delta', 'content_block_stop', 'ping', 'error'];
const deltaTypes = ['thinking_delta', 'text_delta', 'input_json_delta', 'signature_delta', 'citations_delta'];
const stopReasons = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded', 'stop', 'length', 'tool_calls', 'content_filter', 'function_call'];
const eventType = value => member(value, eventTypes) ?? (value ? '(other)' : '(no type)');

export async function observeProviderStream(response, request, save, { signal } = {}) {
  if (!response.body || !request.stream) return Promise.resolve();
  const record = {
    at: new Date().toISOString(), ...providerRequestMetadata(request), httpStatus: response.status,
    requestChars: JSON.stringify(request).length,
    toolNames: (request.tools ?? []).map(t => identifier(t.name ?? t.function?.name)).filter(Boolean),
    frames: [], counts: {}, deltaStats: {}, deltaCharacterUnit: 'utf16_code_units', usage: [], bytes: 0, eof: false,
  };
  const reader = response.clone().body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const aborted = Symbol('observer-aborted');
  let resolveAbort;
  const abortPromise = new Promise(resolve => { resolveAbort = resolve; });
  const onAbort = () => {
    record.cancelled = true;
    // A tee branch's cancel promise can wait for its sibling. Do not await it:
    // persist the observed prefix even if the provider/SDK branch never settles.
    void reader.cancel('Metadata observation cancelled').catch(() => {});
    resolveAbort(aborted);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const frame = raw => {
    const lines = raw.split('\n');
    const event = eventType(lines.find(line => line.startsWith('event:'))?.slice(6).trim());
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const at = new Date().toISOString();
    record.firstFrameAt ??= at; record.lastFrameAt = at;
    if (data === '[DONE]') { record.frames.push({ at, event, type: '[DONE]' }); return; }
    let body;
    try { body = JSON.parse(data); }
    catch { record.frames.push({ at, event, invalidJson: true, chars: data.length }); return; }
    if (!body || typeof body !== 'object') { record.frames.push({ at, event, invalidShape: true }); return; }
    const type = eventType(body.type);
    const deltaType = body.delta?.type ? member(body.delta.type, deltaTypes) ?? '(other)' : '';
    const label = `${event}/${type}/${deltaType}`;
    record.counts[label] = (record.counts[label] ?? 0) + 1;
    const usage = usageMetadata(body.usage ?? body.message?.usage);
    if (usage) record.usage.push({ at, event: type, values: usage });
    if (type === 'content_block_delta') {
      record.firstDeltaAt ??= at; record.lastDeltaAt = at;
      const stats = record.deltaStats[deltaType || '(no type)'] ??= { events: 0, characters: 0, firstAt: at, lastAt: at };
      stats.events++; stats.lastAt = at;
      // Count string payloads, including partial tool JSON, but retain none of them.
      stats.characters += Object.entries(body.delta ?? {}).reduce((total, [key, value]) =>
        total + (key !== 'type' && typeof value === 'string' ? value.length : 0), 0);
      return;
    }
    const errorType = member(body.error?.type, ['invalid_request_error', 'authentication_error', 'permission_error',
      'not_found_error', 'request_too_large', 'rate_limit_error', 'api_error', 'overloaded_error']);
    record.frames.push(compact({ at, event, type, index: nonnegative(body.index),
      blockType: member(body.content_block?.type, ['thinking', 'redacted_thinking', 'text', 'tool_use', 'server_tool_use']),
      toolName: identifier(body.content_block?.name),
      stopReason: member(body.delta?.stop_reason ?? body.message?.stop_reason, stopReasons),
      // Provider error.message can echo request contents or credentials.
      error: body.error ? compact({ type: errorType, status: nonnegative(body.error.status) }) : undefined,
      finishReasons: Array.isArray(body.choices) ? body.choices.map(choice => member(choice.finish_reason, stopReasons)).filter(Boolean) : undefined,
    }));
  };
  return (async () => {
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), abortPromise]);
        if (chunk === aborted || record.cancelled) break;
        if (chunk.done) break;
        const at = new Date().toISOString();
        record.firstByteAt ??= at; record.lastByteAt = at;
        record.bytes += chunk.value.length;
        pending += decoder.decode(chunk.value, { stream: true });
        pending = pending.replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          frame(pending.slice(0, end)); pending = pending.slice(end + 2);
        }
      }
      if (!record.cancelled) {
        pending += decoder.decode();
        if (pending.trim()) frame(pending);
        record.eof = true;
      } else record.pendingChars = pending.length;
    } catch (error) {
      // Stream exceptions can also contain provider payloads: retain the class only.
      record.readError = member(error?.name, ['Error', 'TypeError', 'AbortError', 'TimeoutError']) ?? 'Error';
    } finally {
      record.finishedAt = new Date().toISOString();
      signal?.removeEventListener('abort', onAbort);
      reader.releaseLock();
      await save(record);
    }
  })();
}
