import { Queue, Worker, QueueEvents, type QueueOptions } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const globalForRedis = globalThis as unknown as { redis?: IORedis };
export const redis =
  globalForRedis.redis ??
  new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

const defaults: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: 500,
  },
};

export const ingestQueue = new Queue('ingest', defaults);
export const normalizeQueue = new Queue('normalize', defaults);
export const detectQueue = new Queue('detect', defaults);
export const notifyQueue = new Queue('notify', defaults);

export const queues = { ingestQueue, normalizeQueue, detectQueue, notifyQueue };
export { Worker, QueueEvents };
