// Run only on the designated Linux test host, with a fresh task-owned data dir.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDotenv } from '../packages/backend-core/dist/config.js';

if (process.platform !== 'linux') throw new Error('This smoke server is for Linux/208 only');
const [providerEnv, outputDir, backendPort = '19330'] = process.argv.slice(2);
if (!providerEnv || !outputDir) throw new Error('Usage: node scripts/workflow-app-smoke-server.mjs <provider-env> <new-output-dir> [port]');
const output = resolve(outputDir);
await mkdir(output, { recursive: false });
const secrets = await parseDotenv(providerEnv);
const key = secrets.SQZ_API_KEY || secrets.CUSTOM_API_KEY;
const model = secrets.BP_MODEL;
if (!key || !model || !secrets.CUSTOM_BASE_URL) throw new Error('Test provider configuration is incomplete');
Object.assign(process.env, {
  ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: secrets.CUSTOM_BASE_URL.replace(/\/+$/, '').replace(/\/v1$/, ''),
  ANTHROPIC_MODEL: model, BP_MODEL: model, BP_DATA_DIR: `${output}/data`,
  BP_LOCAL_MODE: '1', BP_ORCHESTRATOR: 'local', PI_CODING_AGENT_DIR: `${output}/pi-agent`,
  BP_KB_ROOT: `${output}/knowledge-base`,
});
const { startServer } = await import('../packages/backend-core/dist/server.js');
const server = await startServer({ port: Number(backendPort), runtimePort: Number(backendPort) + 1,
  hostname: '127.0.0.1', mode: 'local', dataDir: `${output}/data`,
  serveWeb: true, webRoot: resolve('packages/web/dist'), eager: true,
});
console.log(JSON.stringify({ status: 'ready', port: server.port, model, output, isolation: 'loopback/single-user' }));
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await server.stop(); process.exit(0); };
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
