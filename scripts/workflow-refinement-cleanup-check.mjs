#!/usr/bin/env node
/** Zero-provider whole-probe STOP regression. The preload forwards no supplied
 * URL, headers or body: it returns only a loopback SSE stream to the real Pi SDK.
 * No submit_result or successful model response is fabricated.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [sourceStudy, output] = process.argv.slice(2);
assert(process.platform === 'linux' && isAbsolute(sourceStudy ?? '') && isAbsolute(output ?? ''), 'Pass source-study and NEW output paths on 208.');
const preload = `
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const output = ${JSON.stringify(output)};
const realFetch = globalThis.fetch;
let localRequests = 0;
const server = createServer((_request, response) => {
  localRequests++;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (type, data) => response.write('event: ' + type + '\\ndata: ' + JSON.stringify({type, ...data}) + '\\n\\n');
  send('message_start', {message:{id:'msg_local_cleanup',type:'message',role:'assistant',model:'kimi-k3',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
  send('content_block_start', {index:0,content_block:{type:'thinking',thinking:''}});
  send('content_block_delta', {index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_ZERO_PROVIDER_SENTINEL'}});
  const timer = setInterval(() => response.write(': loopback keepalive\\n\\n'), 25);
  setTimeout(() => { void writeFile(join(output,'STOP'),'zero-provider cleanup regression\\n'); }, 150);
  response.on('close', () => { clearInterval(timer); server.close(); });
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
globalThis.fetch = async (_request, init) => {
  if (localRequests) throw new Error('Zero-provider fixture permits one loopback request.');
  await writeFile(join(output,'zero-provider-network.json'), JSON.stringify({providerRequests:0,transport:'loopback-http-sse',forwardsCredentials:false}));
  return realFetch('http://127.0.0.1:' + server.address().port + '/stream', { signal:init?.signal });
};
`;
const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
  join(dirname(fileURLToPath(import.meta.url)), 'workflow-refinement-probe.mjs'),
  '--source-study', sourceStudy, '--output', output, '--mode', 'run'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', timedOut = false;
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const started = Date.now();
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20_000);
const [code, signal] = await new Promise(done => child.once('exit', (...values) => done(values)));
clearTimeout(timer);
const evidence = { kind: 'zero-provider-whole-probe-cleanup', elapsedMs: Date.now() - started,
  childExitCode: code, childSignal: signal, timedOut, naturalExit: !timedOut && signal === null,
  providerRequests: 0, stdout, stderr };
await writeFile(output + '-cleanup-check.json', JSON.stringify(evidence, null, 2) + '\n');
assert(!timedOut, 'Probe did not exit naturally after STOP.');
assert.equal(signal, null); assert.equal(code, 2, stderr);
const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
assert.equal(report.result, 'interrupted'); assert.equal(report.stopReason, 'operator_stop_file');
assert.equal(report.submissions, 0); assert.equal(report.principalPrompts, 0);
assert.equal(report.run.status, 'cancelled'); assert.equal(report.run.artifacts.length, 0);
assert.equal(report.originalEvidenceUnchanged, true);
const streams = (await readFile(join(output, 'provider-streams.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(streams.length, 1); assert.equal(streams[0].eof, false);
assert(streams[0].counts['content_block_delta/content_block_delta/thinking_delta'] >= 1);
assert(!JSON.stringify(streams).includes('PRIVATE_ZERO_PROVIDER_SENTINEL'));
assert(!streams[0].frames.some(frame => frame.type === 'message_stop'));
console.log(JSON.stringify({ ...evidence, hostStatus: report.run.status, savedStreamMetadata: true, report: join(output, 'report.json') }));
