import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { vi, expect } from 'vitest';

export async function buildCrashWorker() {
  const directory = resolve('test-results', `crash-worker-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, 'worker.mjs');
  await build({ entryPoints: [resolve('test/workflow/crash-worker.ts')], outfile: output, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', target: 'node22',
    alias: { '@shared': resolve('shared') }, tsconfigRaw: {},
    plugins: [{ name: 'controlled-boundaries', setup(builder) {
      builder.onLoad({ filter: /server\/services\/publishers\/mastodon\.ts$/ }, () => ({ loader: 'ts', contents:
        'export const publishToMastodon = (...args: any[]) => (globalThis as any).__workflowPublisher(...args);' }));
      builder.onLoad({ filter: /server\/(jobs\/handlers\/publish-draft|services\/openRouter|services\/email\/index)\.ts$/ }, async ({ path }) => {
        let contents = await readFile(path, 'utf8');
        let anchor = 'export async function sendAppEmail(email: AppEmail): Promise<{ skipped?: boolean; messageId?: string }> {';
        let injection = '\n return (globalThis as any).__workflowEmail(email);';
        if (path.endsWith('publish-draft.ts')) {
          anchor = 'await storage.authorizePublishClaim(scope, draftId, draftScheduleTargetId, claim.token);';
          injection = '\n await (globalThis as any).__workflowPhase("authorized");';
        } else if (path.endsWith('openRouter.ts')) {
          anchor = 'export async function generateTextWithMetadata(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {';
          injection = '\n return (globalThis as any).__workflowAI();';
        }
        expect(contents.split(anchor)).toHaveLength(2);
        contents = contents.replace(anchor, anchor + injection);
        return { loader: 'ts', contents };
      });
    } }],
  });
  return { output, remove: () => rm(directory, { recursive: true, force: true }) };
}

export type WorkerEvent = { event: string; pid: number; id?: string; jobId?: string; result?: any; [key: string]: any };
export class CrashProcess {
  readonly events: WorkerEvent[] = [];
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private output = '';
  constructor(bundle: string) {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'DATABASE_URL', 'TEST_DATABASE_URL', 'BETTER_AUTH_SECRET',
      'WEBHOOK_ENCRYPTION_SECRET', 'PUBLISHING_MODE', 'REDIS_URL', 'WORKFLOW_GUARD_LOG'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
    Object.assign(env, { NODE_ENV: 'test', TZ: 'UTC', WORKFLOW_CRASH_TESTS: 'true', DB_POOL_MAX: '4', DB_CONNECTION_TIMEOUT_MS: '2000',
      WORKFLOW_CHILD_REDIS_PORT: new URL(env.REDIS_URL).port });
    this.child = spawn(process.execPath, ['--require', resolve('test/workflow/crash-guard.cjs'), bundle], {
      env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child.stdout!.on('data', data => { this.output += String(data); });
    this.child.stderr!.on('data', data => { this.output += String(data); });
    this.child.on('message', message => { this.events.push(message as WorkerEvent); });
    this.exited = once(this.child, 'exit').then(([code, signal]) => ({ code, signal }));
  }
  async wait(event: string, predicate: (message: WorkerEvent) => boolean = () => true) {
    let found: WorkerEvent | undefined;
    await vi.waitFor(() => {
      const fatal = this.events.find(e => e.event === 'fatal');
      if (fatal) throw new Error(JSON.stringify(fatal));
      found = this.events.find(e => e.event === event && predicate(e));
      expect(found, `Waiting for ${event}; worker output: ${this.output}`).toBeDefined();
    }, { timeout: 12000, interval: 30 });
    return found!;
  }
  async command(action: string, extra: object = {}) {
    const id = randomUUID(); this.child.send({ id, action, ...extra });
    return this.wait('reply', message => message.id === id);
  }
  startEditorial(jobId: string) { this.child.send({ id: randomUUID(), action: 'editorial', jobId, phase: 'ai-started' }); }
  async kill() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.exited;
    this.child.kill('SIGKILL');
    const result = await this.exited;
    expect(result).toEqual({ code: null, signal: 'SIGKILL' });
    return result;
  }
  async close() {
    if (this.child.exitCode === null && this.child.signalCode === null) await this.kill();
    await writeFile(resolve('test-results', `workflow-crash-child-${this.child.pid}.json`), JSON.stringify({ pid: this.child.pid,
      exit: await this.exited, events: this.events, output: this.output }, null, 2));
  }
}