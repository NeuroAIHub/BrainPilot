/*
 * deepresearch-verification-probe.mjs — one raw-wire replay of an operator-supplied RECONSTRUCTED
 * deep-research verification request, asking a single question: does the provider return a complete
 * submit_result at a larger output allowance?
 *
 * Provenance, stated exactly: no original complete wire body was ever saved. The request file is
 * explicitly RECONSTRUCTED from the exact user input plus the frozen instructions and schema plus
 * the known wire metadata. So this is a replay of an operator-supplied reconstructed request. It is
 * NOT original-wire equivalence, and it is NOT the native host or the full workflow: no
 * SessionManager, no WorkflowHost, no profile creation, no Pi initialization, no workspace writing.
 *
 * max_tokens is the only field that differs between the provided RECONSTRUCTED baseline and the
 * candidate body; byte-identical replay of the original native wire is not claimed. No pipeline API
 * parameters and no source facts are changed, and the file hashes prove only that the provided
 * fixture was left unchanged. The reply is judged as transport + schema + membership. A
 * verification that legitimately says "unverified" is a complete diagnostic; it is never scientific
 * clearance, and this says nothing about workflow resume or acceptance.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FLAGS = ['--request', '--verification-input', '--provider-env', '--output', '--max-output-tokens', '--timeout-ms'];
const USAGE = `Linux only. Usage: node scripts/deepresearch-verification-probe.mjs ${FLAGS.map(f => `${f}=<value>`).join(' ')}`;
const BYTE_CAP = 64 * 1024 * 1024;
const here = dirname(fileURLToPath(import.meta.url));

/** Strict flag parsing: unknown, repeated, empty or malformed arguments abort before any file is made. */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const split = token.indexOf('=');
    const name = split < 0 ? token : token.slice(0, split);
    if (!FLAGS.includes(name)) throw Error(`unknown argument\n${USAGE}`);
    const value = split < 0 ? argv[++index] : token.slice(split + 1);
    if (!value || name in args) throw Error(`missing or repeated value for ${name}\n${USAGE}`);
    args[name] = value;
  }
  for (const name of FLAGS.slice(0, 4)) if (!args[name]) throw Error(`${name} is required\n${USAGE}`);
  return args;
}
function integerArg(raw, fallback, min, max, name) {
  if (raw === undefined) return fallback;
  if (!/^\d+$/u.test(raw)) throw Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw Error(`${name} must be within ${min}..${max}`);
  return value;
}

const equal = (left, right) => { try { deepStrictEqual(left, right); return true; } catch { return false; } };

const report = {
  diagnostic: 'deepresearch-verification-probe',
  boundary: 'replay of operator-supplied reconstructed request; not original-wire equivalence, not native host/full workflow',
  providerRequests: 0, httpStatus: null, normalEof: false, stopReason: null, elapsedMs: null,
  usage: {}, thinkingChars: 0, textChars: 0, toolChars: 0, validSubmissions: 0,
  diagnosticComplete: false, verificationCheck: null, rejections: [], error: null, sourceHashesUnchanged: null,
};
let out = null, scrub = (value) => String(value), created = false;
const save = (name, value) => writeFile(join(out, name),
  scrub(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`), { mode: 0o600 });
const reject = (code) => { if (!report.rejections.includes(code)) report.rejections.push(code); };

try {
  if (process.platform !== 'linux') throw Error(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const maxOutputTokens = integerArg(args['--max-output-tokens'], 65536, 32768, 65536, '--max-output-tokens');
  const timeoutMs = integerArg(args['--timeout-ms'], 1_200_000, 1, 1_200_000, '--timeout-ms');

  // Credentials, parsed exactly like scripts/workflow-protocol-diagnostic.mjs. The key is only ever
  // used as a request header and as the needle of the scrubber; it is never written or printed.
  const env = {};
  for (const line of (await readFile(args['--provider-env'], 'utf8')).split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  const key = env.SQZ_API_KEY || env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY;
  const configured = env.CUSTOM_BASE_URL || env.ANTHROPIC_BASE_URL;
  // Every protocol variable this repo's provider files are known to use is recognised, BP_API first.
  // A declared protocol other than anthropic-messages aborts the probe rather than replaying a body
  // the provider would read differently. Credentials themselves are never altered here.
  const protocol = env.BP_API || env.CUSTOM_API || env.ANTHROPIC_API || env.CUSTOM_API_PROTOCOL;
  if (!key || !configured) throw Error('Missing existing provider settings');
  if (protocol && protocol !== 'anthropic-messages') throw Error('provider-env declares a non anthropic-messages protocol');
  scrub = (value) => String(value).split(key).join('[REDACTED]');
  const base = configured.replace(/\/+$/u, '').replace(/\/v1$/u, '');

  out = resolve(args['--output']);
  await mkdir(out, { mode: 0o700 });
  created = true;

  // The two originals are read once, hashed as bytes, and never written back to.
  const requestPath = resolve(args['--request']), inputPath = resolve(args['--verification-input']);
  const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const requestBytes = await readFile(requestPath), inputBytes = await readFile(inputPath);
  const sourceHashes = { request: sha256(requestBytes), verificationInput: sha256(inputBytes) };
  const original = JSON.parse(requestBytes.toString('utf8'));
  const verificationInput = JSON.parse(inputBytes.toString('utf8'));

  // The provided RECONSTRUCTED file is the Anthropic body itself, with no wrapper. Asserted, never
  // assumed. These asserts describe the reconstruction, not a recovered original wire body.
  const assert = (condition, code) => { if (!condition) throw Error(`request_assert_${code}`); };
  assert(original && typeof original === 'object' && !Array.isArray(original), 'body_is_object');
  assert(original.model === 'kimi-k3', 'model');
  assert(original.stream === true, 'stream');
  assert(original.max_tokens === 32768, 'original_max_tokens');
  deepStrictEqual(original.thinking, { type: 'enabled', budget_tokens: 2048, display: 'summarized' });
  assert(Array.isArray(original.tools) && original.tools.length === 1, 'tools_length');
  const submitTool = original.tools[0];
  assert(submitTool?.name === 'submit_result', 'tool_name');
  assert(submitTool.input_schema && typeof submitTool.input_schema === 'object', 'tool_input_schema');
  assert(Array.isArray(original.messages) && original.messages.length > 0, 'messages');
  const userTexts = original.messages.filter((message) => message?.role === 'user').flatMap((message) =>
    typeof message.content === 'string' ? [message.content]
      : (Array.isArray(message.content) ? message.content.filter((block) => typeof block?.text === 'string').map((block) => block.text) : []));
  // The fixture is exactly one user text, and that whole text is the standalone normalized-inputs
  // JSON. It must parse as JSON and be deep-equal to the saved inputs; a parse failure is reported
  // as exactly that. No permissive search for JSON embedded in surrounding instructions is made.
  assert(userTexts.length === 1, 'single_user_text');
  let userJson = null;
  try { userJson = JSON.parse(userTexts[0]); } catch { assert(false, 'user_text_is_not_standalone_json'); }
  assert(equal(userJson, verificationInput), 'user_text_equals_verification_input');

  // Membership truth comes from the normalized inputs, never from the model's reply.
  const paragraphIds = (verificationInput.paragraphs ?? []).map((paragraph) => paragraph.paragraphId);
  const facetIds = (verificationInput.facets ?? []).map((facet) => facet.facetId);
  const knownClaimIds = new Set((verificationInput.claims ?? []).map((claim) => claim.claimId));
  const citedClaimIds = new Set((verificationInput.paragraphs ?? []).flatMap((paragraph) =>
    (paragraph.claimIds ?? []).filter((claimId) => knownClaimIds.has(claimId))));
  assert(paragraphIds.length > 0 && paragraphIds.every((id) => typeof id === 'string'), 'input_paragraph_ids');
  assert(facetIds.length > 0 && facetIds.every((id) => typeof id === 'string'), 'input_facet_ids');

  // max_tokens is the only field that differs between the provided RECONSTRUCTED baseline and the
  // candidate body. Restoring it and comparing proves nothing else in the provided body moved; it
  // does not claim byte equivalence with the original native wire, which was never saved.
  const replay = structuredClone(original);
  replay.max_tokens = maxOutputTokens;
  const proof = structuredClone(replay);
  proof.max_tokens = original.max_tokens;
  deepStrictEqual(proof, original);

  await save('manifest.json', {
    boundary: 'Replay of an operator-supplied reconstructed request; not original-wire equivalence, not the native host or full workflow. Not a workflow resume and not workflow acceptance.',
    provenance: 'No original complete wire body was ever saved. The request file is explicitly RECONSTRUCTED from the exact user input, the frozen instructions and schema, and the known wire metadata. max_tokens differs only between this provided RECONSTRUCTED baseline and the candidate body; no pipeline API parameters and no source facts were changed. The hashes below prove only that the provided fixture is unchanged.',
    model: replay.model, thinking: replay.thinking, reconstructedBaselineMaxTokens: original.max_tokens,
    maxOutputTokens, timeoutMs, endpoint: '/v1/messages', endpointHash: sha256(Buffer.from(configured, 'utf8')),
    credentialReference: args['--provider-env'],
    sources: [{ role: 'reconstructed-request', path: requestPath, sha256: sourceHashes.request },
      { role: 'verification-input', path: inputPath, sha256: sourceHashes.verificationInput }],
    paragraphCount: paragraphIds.length, facetCount: facetIds.length, citedClaimCount: citedClaimIds.size,
  });
  await save('request.json', replay);

  const { compileWorkflowValidator } = await import('@brainpilot/plugin-sdk/workflow');
  const { researchVerificationSchema } = await import(pathToFileURL(join(here, '..', 'packages', 'runtime', 'dist', 'workflows', 'deep-research-contract.js')).href);
  const { checkVerification } = await import(pathToFileURL(join(here, '..', 'packages', 'runtime', 'dist', 'workflows', 'deep-research.js')).href);

  // One request, counted before it is made, with no retry and no other network call.
  let raw = '', bytes = 0, reader = null;
  const began = Date.now();
  report.providerRequests = 1;
  try {
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST', redirect: 'manual',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(replay), signal: AbortSignal.timeout(timeoutMs),
    });
    report.httpStatus = response.status;
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { report.normalEof = true; raw += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > BYTE_CAP) throw Error('response exceeds the 64 MiB diagnostic cap');
      raw += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    report.error = scrub(error.message);
    if (reader) await reader.cancel().catch(() => {});
  } finally {
    report.elapsedMs = Date.now() - began;
    try { reader?.releaseLock(); } catch { /* already released with the stream */ }
  }
  await save('response.sse', raw);
  if (report.httpStatus !== 200) reject('http_status_not_200');
  if (!report.normalEof) reject('stream_did_not_reach_eof');
  if (report.error) reject('transport_error');

  // SSE framing, same pattern as the protocol diagnostic: blank-line frames, CRLF or LF.
  const frames = raw.split(/\r?\n\r?\n/u);
  const trailing = (frames.pop() ?? '').trim();
  if (trailing !== '') reject('trailing_unframed_data');
  const blocks = new Map();
  let starts = 0, typedStop = false;
  for (const frame of frames) {
    const lines = frame.split(/\r?\n/u);
    const header = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? null;
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    let event;
    try { event = JSON.parse(data); } catch { reject('unparsable_sse_frame'); continue; }
    if (header === 'error' || event.type === 'error') reject('provider_error_event');
    if (event.type === 'message_start') { starts++; }
    if (event.type === 'message_stop') typedStop = true;
    if (event.delta?.stop_reason) report.stopReason = event.delta.stop_reason;
    for (const usage of [event.message?.usage, event.usage]) {
      // Final value per field. Duplicate start/final usage objects overwrite, never accumulate.
      if (usage && typeof usage === 'object') {
        for (const [field, value] of Object.entries(usage)) if (typeof value === 'number') report.usage[field] = value;
      }
    }
    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'thinking_delta') report.thinkingChars += (event.delta.thinking ?? '').length;
      if (event.delta?.type === 'text_delta') report.textChars += (event.delta.text ?? '').length;
      if (event.delta?.type === 'input_json_delta' && blocks.has(event.index)) {
        blocks.get(event.index).args += event.delta.partial_json ?? '';
      }
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      if (blocks.has(event.index)) reject('duplicate_tool_block_index');
      else blocks.set(event.index, { name: event.content_block.name, args: '', initial: event.content_block.input, closed: false });
    }
    if (event.type === 'content_block_stop' && blocks.has(event.index)) blocks.get(event.index).closed = true;
  }
  if (starts !== 1) reject(starts === 0 ? 'missing_message_start' : 'duplicate_message_start');
  if (!typedStop) reject('missing_typed_message_stop');
  if (report.stopReason === 'max_tokens' || report.stopReason === 'length') reject('output_limit_stop');
  else if (report.normalEof && report.stopReason !== 'tool_use' && report.stopReason !== 'end_turn') reject('unexpected_stop_reason');

  const tools = [...blocks.values()];
  report.toolChars = tools.reduce((total, block) => total + block.args.length, 0);
  if (tools.some((block) => block.name !== 'submit_result')) reject('unknown_tool_returned');
  if (tools.length !== 1) reject(tools.length === 0 ? 'no_tool_returned' : 'duplicate_tool_returned');
  const submission = tools.length === 1 && tools[0].name === 'submit_result' && tools[0].closed ? tools[0] : null;
  if (tools.length === 1 && !tools[0].closed) reject('tool_block_never_closed');

  // Schema and membership. A truncated or partially parsed submission is never valid.
  let schemaValid = false, membershipValid = false;
  if (submission) {
    let args = null;
    try { args = submission.args.length ? JSON.parse(submission.args) : submission.initial; } catch { reject('tool_arguments_not_json'); }
    if (args && typeof args === 'object' && !Array.isArray(args) && args.result !== undefined) {
      try {
        compileWorkflowValidator(submitTool.input_schema, 'submit_result arguments')(args);
        compileWorkflowValidator(researchVerificationSchema, 'deep-research verification')(args.result);
        schemaValid = true;
        report.validSubmissions = 1;
      } catch (error) { reject('schema_invalid'); report.error ??= scrub(error.message); }
      if (schemaValid) {
        const check = checkVerification(args.result, paragraphIds, facetIds, citedClaimIds.size);
        report.verificationCheck = check;
        // Membership/coverage only. check.ok false is a real negative verdict, not a transport fault,
        // so it never blocks diagnostic completion — and never counts as scientific clearance either.
        membershipValid = !check.reasons.some((reason) => /^(?:paragraph|facet)_(?:duplicated|unknown|omitted)$/u.test(reason));
        if (!membershipValid) reject('membership_invalid');
        await save('verification.json', {
          note: 'Model-returned verification, schema-valid and membership-checked. check.ok false is a negative verdict on the draft, not scientific clearance and not a transport failure.',
          result: args.result, check,
        });
      }
    } else if (args) reject('tool_arguments_missing_result');
  }
  // Transport is judged on everything except the two content verdicts above.
  const transportComplete = !report.rejections.some((code) => !['membership_invalid', 'schema_invalid'].includes(code));
  report.diagnosticComplete = transportComplete && schemaValid && membershipValid;

  const after = { request: sha256(await readFile(requestPath)), verificationInput: sha256(await readFile(inputPath)) };
  report.sourceHashesUnchanged = equal(after, sourceHashes);
  report.sourceHashes = sourceHashes;
} catch (error) {
  report.error ??= scrub(error?.message ?? error);
  report.rejections.push('probe_error');
} finally {
  if (created) await save('report.json', report).catch(() => {});
  console.log(JSON.stringify({
    httpStatus: report.httpStatus, providerRequests: report.providerRequests, normalEof: report.normalEof,
    stopReason: report.stopReason, elapsedMs: report.elapsedMs, usage: report.usage,
    thinkingChars: report.thinkingChars, textChars: report.textChars, toolChars: report.toolChars,
    validSubmissions: report.validSubmissions, diagnosticComplete: report.diagnosticComplete,
    verificationOk: report.verificationCheck?.ok ?? null, verificationReasons: report.verificationCheck?.reasons ?? [],
    rejections: report.rejections, error: report.error, sourceHashesUnchanged: report.sourceHashesUnchanged,
  }, null, 2));
  process.exitCode = report.diagnosticComplete && report.sourceHashesUnchanged === true ? 0 : 2;
}
