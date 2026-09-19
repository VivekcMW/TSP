// Bundled by the test with boundary-only substitutions and one phase barrier.
import { initializeQueues, getPublishDraftQueue, queueOptions, closeQueues } from '../../server/jobs/queue';
import { handlePublishDraft } from '../../server/jobs/handlers/publish-draft';
import { EditorialJobs } from '../../server/jobs/editorial';
import { redis } from '../../server/lib/redis';
import { pool } from '../../server/db';
import Bull from 'bull';

type Command = { id: string; action: string; phase?: string; jobId?: string };
let phase = '';
const send = (event: string, data: object = {}) => process.send?.({ event, pid: process.pid, ...data });
async function barrier(name: string, data: object = {}) {
  send(name, data);
  if (phase === 'retry-once' && name === 'authorized') {
    phase = ''; throw new Error('Controlled pre-dispatch transient failure');
  }
  if (phase === name) await new Promise<void>(() => {});
}
// Only the test bundle refers to this hook; application files are not changed.
(globalThis as any).__workflowPhase = barrier;
(globalThis as any).__workflowPublisher = async (_scope: unknown, draftId: string) => {
  await barrier('accepted', { draftId, postId: `fixture-receipt-${draftId}` });
  return { success: true, postId: `fixture-receipt-${draftId}` };
};
(globalThis as any).__workflowAI = async () => {
  await barrier('ai-started');
  throw new Error('Unexpected released AI boundary');
};
(globalThis as any).__workflowEmail = async (email: { type: string }) => { send('email', { type: email.type }); return { skipped: true }; };

if (!process.send || process.env.WORKFLOW_CRASH_TESTS !== 'true') throw new Error('Owned IPC worker only');
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || url.port !== '60053' || url.pathname !== '/thesocialpundit_acceptance_test' || url.username !== 'tsp_app') throw new Error('Unsafe child database');
initializeQueues();
const queue = getPublishDraftQueue()!;
// Test-only bounded lock/stall timings, same production queue + handler.
Object.assign((queue as any).settings, { lockDuration: 1200, lockRenewTime: 300, stalledInterval: 500, maxStalledCount: 1 });
const editorialQueue = new Bull('editorial_generation', queueOptions(process.env.REDIS_URL!));
const editorial = new EditorialJobs(redis!, editorialQueue);
queue.on('completed', (job, result) => send('completed', { jobId: String(job.id), result }));
queue.on('failed', (job, error) => send('failed', { jobId: String(job.id), error: error.message }));
queue.on('stalled', job => send('stalled', { jobId: String(job.id) }));
process.on('message', async (command: Command) => {
  try {
    if (command.action === 'publish') {
      phase = command.phase ?? '';
      void queue.process(1, async job => {
        await barrier('before-claim', { jobId: String(job.id), attemptsMade: job.attemptsMade });
        return handlePublishDraft(job);
      }).catch(error => send('fatal', { error: String(error) }));
    } else if (command.action === 'editorial') {
      phase = command.phase ?? '';
      await editorial.process(command.jobId!);
    } else if (command.action === 'stop') {
      editorial.abortWorkers(); await editorialQueue.close(); await closeQueues(); redis!.disconnect(); await pool.end();
      send('reply', { id: command.id }); process.disconnect(); return;
    }
    send('reply', { id: command.id });
  } catch (error) { send('fatal', { error: String(error), id: command.id }); }
});
process.on('disconnect', () => process.exit(0));
await queue.isReady();
send('ready');