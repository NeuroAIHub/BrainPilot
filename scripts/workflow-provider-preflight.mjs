// Linux/208 only. Bounded real-provider text, tool and image compatibility probe.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (process.platform !== 'linux') throw new Error('Run this probe on 208/Linux only');
const [reference, directory, selectedModel] = process.argv.slice(2);
if (!reference || !directory || process.argv.length > 5) throw new Error('Usage: provider-env new-output-directory [model-id]');
const output = resolve(directory); await mkdir(output, { recursive: false, mode: 0o700 });
const env = {};
for (const line of (await readFile(reference, 'utf8')).split(/\r?\n/)) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[match[1]] = value;
}
const key = env.SQZ_API_KEY || env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY;
const modelId = selectedModel || env.BP_MODEL || env.ANTHROPIC_MODEL;
const configuredBase = env.CUSTOM_BASE_URL || env.ANTHROPIC_BASE_URL;
if (!key || !modelId || !configuredBase) throw new Error('Existing test provider reference is incomplete');
const base = configuredBase.replace(/\/+$/, '').replace(/\/v1$/, '');
const redact = value => JSON.stringify(value, null, 2).split(key).join('[REDACTED]');
const report = { startedAt: new Date().toISOString(), modelId, modelWasExplicitlySelected: Boolean(selectedModel),
  endpointHash: createHash('sha256').update(configuredBase).digest('hex'), credentialReference: reference,
  protocol: 'anthropic-messages', output, text: { status: 'not_run' }, tool: { status: 'not_run' }, image: { status: 'not_run' } };
const save = () => writeFile(join(output, 'preflight.json'), redact(report) + '\n', { mode: 0o600 });
async function request(label, body) {
  const start = Date.now();
  try {
    const response = await fetch(base + '/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, max_tokens: 256, stream: false, ...body }), signal: AbortSignal.timeout(90_000),
    });
    const data = await response.json();
    const result = { status: response.ok ? 'received' : 'failed', httpStatus: response.status,
      latencyMs: Date.now() - start, responseModel: data.model, usage: data.usage,
      content: data.content, ...(data.error ? { error: data.error } : {}) };
    report[label] = result; await save(); return result;
  } catch (error) { const result = { status: 'failed', error: error.message, latencyMs: Date.now() - start }; report[label] = result; await save(); return result; }
}
const text = await request('text', { messages: [{ role: 'user', content: 'Reply with exactly READY. No explanation.' }] });
text.status = text.httpStatus === 200 && text.content?.some(c => c.type === 'text' && c.text.trim() === 'READY') ? 'passed' : 'failed'; await save();
if (text.status === 'passed') {
  const tool = await request('tool', { tools: [{ name: 'submit_result', description: 'Submit the verification value.', input_schema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } }],
    messages: [{ role: 'user', content: 'Use submit_result once with value 37. Do not answer in plain text.' }] });
  tool.status = tool.httpStatus === 200 && tool.content?.some(c => c.type === 'tool_use' && c.name === 'submit_result' && c.input?.value === 37) ? 'passed' : 'failed'; await save();
  const challenge = randomBytes(4).toString('hex').toUpperCase();
  const tex = String.raw`\documentclass{article}\pagestyle{empty}\begin{document}\begin{center}\Huge Laboratory sample label:\\[1cm]\fontsize{54}{64}\selectfont\texttt{` + challenge + String.raw`}\end{center}\end{document}`;
  await writeFile(join(output, 'image-check.tex'), tex);
  const execute = promisify(execFile);
  await execute('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'image-check.tex'], { cwd: output, timeout: 30_000 });
  await execute('pdftoppm', ['-r', '100', '-png', '-singlefile', 'image-check.pdf', 'image-check'], { cwd: output, timeout: 30_000 });
  const png = await readFile(join(output, 'image-check.png'));
  const image = await request('image', { max_tokens: 1024, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    { type: 'text', text: 'Read the laboratory sample label printed in this image. Reply with that alphanumeric label only.' },
  ] }] });
  image.expected = challenge;
  const read = image.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? '';
  image.status = image.httpStatus === 200 && read.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === challenge ? 'passed' : 'failed';
}
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ modelId, text: report.text.status, tool: report.tool.status, image: report.image.status, report: join(output, 'preflight.json') }));
process.exitCode = report.text.status === 'passed' && report.tool.status === 'passed' && report.image.status === 'passed' ? 0 : 2;
