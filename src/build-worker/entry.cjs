'use strict';

const { loadConfig } = require('./config.cjs');
const { WorkerStore } = require('./store.cjs');
const { JobExecutor } = require('./executor.cjs');
const { createHealthServer } = require('./server.cjs');

async function main() {
  const config = loadConfig();
  const store = new WorkerStore(config);
  const executor = new JobExecutor(config, store);
  const runtime = { ready: false, state: 'starting', activeJobId: null, stopping: false };
  const server = createHealthServer(config, store, runtime);

  await store.initialize();
  await new Promise((resolve) => server.listen(config.port, '0.0.0.0', resolve));
  runtime.ready = true; runtime.state = 'idle';
  console.log(JSON.stringify({
    event: 'worker.ready',
    nodeId: config.nodeId,
    lane: config.lane,
    capabilities: config.capabilities,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
    port: config.port
  }));

  const nodeHeartbeat = setInterval(() => store.heartbeat(runtime.activeJobId, runtime.state).catch((error) => console.error(JSON.stringify({ event: 'worker.heartbeat.error', message: error.message }))), config.heartbeatMs);

  const stop = async (signal) => {
    if (runtime.stopping) return;
    runtime.stopping = true; runtime.ready = false; runtime.state = 'stopping'; clearInterval(nodeHeartbeat);
    console.log(JSON.stringify({ event: 'worker.stopping', signal, nodeId: config.nodeId }));
    await store.heartbeat(runtime.activeJobId, 'stopping').catch(() => {});
    await new Promise((resolve) => server.close(resolve)); await store.close(); process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));

  while (!runtime.stopping) {
    try {
      const job = await store.leaseNextJob();
      if (!job) { await new Promise((resolve) => setTimeout(resolve, config.pollMs)); continue; }
      runtime.activeJobId = job.job_id; runtime.state = 'running'; await store.markRunning(job.job_id);
      console.log(JSON.stringify({ event: 'job.started', nodeId: config.nodeId, jobId: job.job_id, stage: job.stage, lane: job.lane }));
      try {
        const outcome = await executor.execute(job);
        await store.finishJob(job, outcome.status, outcome.result);
        console.log(JSON.stringify({ event: 'job.finished', nodeId: config.nodeId, jobId: job.job_id, status: outcome.status }));
      } catch (error) {
        await store.finishJob(job, 'failed', { error: error.message, output: error.output || '' });
        console.error(JSON.stringify({ event: 'job.failed', nodeId: config.nodeId, jobId: job.job_id, message: error.message }));
      } finally { runtime.activeJobId = null; runtime.state = 'idle'; }
    } catch (error) {
      runtime.state = 'degraded'; console.error(JSON.stringify({ event: 'worker.loop.error', nodeId: config.nodeId, message: error.message }));
      await new Promise((resolve) => setTimeout(resolve, Math.max(config.pollMs, 5_000))); runtime.state = 'idle';
    }
  }
}

main().catch((error) => { console.error(JSON.stringify({ event: 'worker.fatal', message: error.message, stack: error.stack })); process.exit(1); });
