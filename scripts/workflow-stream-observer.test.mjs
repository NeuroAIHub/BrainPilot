/** Zero-provider lifecycle regression: owned child + loopback SSE only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { observeProviderStream, providerRequestMetadata } from "./workflow-stream-observer.mjs";

const PRIVATE = 'PRIVATE_TEXT_SENTINEL';
const thinkingParts = [PRIVATE, '再看🙂'];
const partialJson = JSON.stringify({ result: { latex: PRIVATE } });
const requestFixture = () => ({
  model: 'local-fixture', stream: true, max_tokens: 32768,
  thinking: { type: 'enabled', budget_tokens: 2048, display: 'summarized', secret: PRIVATE },
  output_config: { effort: 'low', format: { schema: { description: PRIVATE } }, secret: PRIVATE },
  tool_choice: { type: 'tool', name: 'submit_result', disable_parallel_tool_use: true, arguments: PRIVATE },
  tools: [{ name: 'submit_result', description: PRIVATE, input_schema: { description: PRIVATE } }],
  messages: [{ role: 'user', content: PRIVATE }], system: PRIVATE, api_key: PRIVATE,
  headers: { authorization: PRIVATE }, metadata: { secret: PRIVATE },
});
const wireFixture = {
  model: 'local-fixture', max_tokens: 32768,
  thinking: { type: 'enabled', budget_tokens: 2048, display: 'summarized' },
  output_config: { effort: 'low' },
  tool_choice: { type: 'tool', name: 'submit_result', disable_parallel_tool_use: true },
};
const frame = (event, value) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
const validTime = value => { assert.equal(typeof value, 'string'); assert(Number.isFinite(Date.parse(value))); };

if (process.argv[2] === '--child') {
  const mode = process.argv[3];
  const controller = new AbortController();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(frame('message_start', { type: 'message_start', message: {
      content: PRIVATE, usage: { input_tokens: 31, output_tokens: 0, secret: PRIVATE,
        cache_creation: { ephemeral_5m_input_tokens: 8, secret: PRIVATE } },
    } }));
    for (const thinking of thinkingParts) response.write(frame('content_block_delta', {
      type: 'content_block_delta', delta: { type: 'thinking_delta', thinking },
    }));
    response.write(frame('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: PRIVATE } }));
    response.write(frame('content_block_start', { type: 'content_block_start', index: 2,
      content_block: { type: 'tool_use', name: 'submit_result', input: { result: PRIVATE } },
    }));
    for (const partial_json of [partialJson.slice(0, 8), partialJson.slice(8)]) response.write(frame('content_block_delta', {
      type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json },
    }));
    response.write(frame('content_block_delta', { type: 'content_block_delta', delta: { type: PRIVATE, secret: PRIVATE } }));
    response.write(frame(PRIVATE, { type: PRIVATE, content: PRIVATE }));
    response.write(frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 17, input_tokens: -1, secret: PRIVATE,
        output_tokens_details: { thinking_tokens: 12, secret: PRIVATE } },
    }));
    response.write(frame('error', { type: 'error', error: { type: 'invalid_request_error', status: 400,
      message: PRIVATE, request: { authorization: PRIVATE } },
    }));
    if (mode === 'complete') response.end(frame('message_stop', { type: 'message_stop' }));
    else {
      const keepalive = setInterval(() => response.write(': keepalive\n\n'), 20);
      response.on('close', () => clearInterval(keepalive));
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/stream`, { signal: controller.signal });
  const records = [];
  const observing = observeProviderStream(response, requestFixture(), async record => { records.push(record); }, { signal: controller.signal });
  const reading = response.text().catch(error => { assert.equal(error.name, 'AbortError'); });
  if (mode === 'abort') setTimeout(() => controller.abort(), 100);
  await Promise.all([reading, observing]);
  await new Promise(done => server.close(done));
  assert.equal(requests, 1);
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.eof, mode === 'complete');
  assert.equal(Boolean(record.cancelled), mode === 'abort');
  for (const [key, value] of Object.entries(wireFixture)) assert.deepEqual(record[key], value);
  assert.equal(record.counts['message_start/message_start/'], 1);
  assert.equal(record.counts['content_block_delta/content_block_delta/thinking_delta'], 2);
  assert.equal(record.frames.some(item => item.type === 'message_stop'), mode === 'complete');
  assert.equal(record.deltaCharacterUnit, 'utf16_code_units');
  for (const [type, events, characters] of [
    ['thinking_delta', 2, thinkingParts.reduce((n, part) => n + part.length, 0)],
    ['text_delta', 1, PRIVATE.length], ['input_json_delta', 2, partialJson.length], ['(other)', 1, PRIVATE.length],
  ]) {
    const stats = record.deltaStats[type];
    assert.equal(stats.events, events); assert.equal(stats.characters, characters);
    validTime(stats.firstAt); validTime(stats.lastAt); assert(stats.firstAt <= stats.lastAt);
  }
  for (const key of ['firstByteAt', 'lastByteAt', 'firstFrameAt', 'lastFrameAt', 'firstDeltaAt', 'lastDeltaAt']) validTime(record[key]);
  assert(record.firstDeltaAt <= record.lastDeltaAt);
  assert.deepEqual(record.usage.map(item => ({ event: item.event, values: item.values })), [
    { event: 'message_start', values: { input_tokens: 31, output_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 8 } } },
    { event: 'message_delta', values: { output_tokens: 17, output_tokens_details: { thinking_tokens: 12 } } },
  ]);
  assert.deepEqual(record.frames.find(item => item.type === 'error').error, { type: 'invalid_request_error', status: 400 });
  assert(!JSON.stringify(record).includes(PRIVATE));
  console.log(JSON.stringify({ mode, requests, providerRequests: 0, record }));
  // Deliberately no process.exit: the parent verifies natural process exit.
} else {
  test('wire metadata allowlist excludes request bodies, schemas and credentials', () => {
    assert.deepEqual(providerRequestMetadata(requestFixture()), wireFixture);
    assert.deepEqual(providerRequestMetadata({ model: 'local-fixture', max_tokens: NaN,
      thinking: { type: PRIVATE, budget_tokens: -1, display: PRIVATE },
      output_config: { effort: PRIVATE }, tool_choice: { type: PRIVATE, name: 'invalid name ' + PRIVATE },
    }), { model: 'local-fixture', thinking: {}, output_config: {}, tool_choice: {} });
    assert.deepEqual(providerRequestMetadata({ tool_choice: 'auto', api_key: PRIVATE }), { tool_choice: 'auto' });
    assert(!JSON.stringify(providerRequestMetadata(requestFixture())).includes(PRIVATE));
  });
  test('stream read errors retain only the error class', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error(PRIVATE)); } }));
    const records = [];
    await observeProviderStream(response, requestFixture(), async record => { records.push(record); });
    assert.equal(records.length, 1); assert.equal(records[0].readError, 'Error'); assert.equal(records[0].eof, false);
    assert(!JSON.stringify(records).includes(PRIVATE));
  });
  for (const mode of ['complete', 'abort']) test(`stream observer ${mode}: preserves metadata and exits naturally`, async () => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5000);
    const [code, signal] = await new Promise(done => child.once('exit', (...result) => done(result)));
    clearTimeout(timer);
    assert.equal(timedOut, false, 'Observer child remained alive: ' + stdout + stderr);
    assert.equal(signal, null); assert.equal(code, 0, stderr);
    const evidence = JSON.parse(stdout.trim());
    assert.equal(evidence.providerRequests, 0);
  });
}
