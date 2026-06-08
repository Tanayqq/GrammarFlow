const { Queue } = require('bullmq');
const { redisConnection } = require('./queue');

// Dedicated queue for asynchronous AI history logging
// Reuses the same Redis connection derived in queue.js
const aiHistoryQueue = new Queue('ai-history', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000 // 2s, 4s, 8s retries
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50       // Keep last 50 failed jobs for debugging
    }
});

aiHistoryQueue.on('error', (err) => {
    console.error('[BULLMQ HISTORY QUEUE ERROR]', err.message);
});

console.log('[BULLMQ] History queue "ai-history" initialized.');

module.exports = { aiHistoryQueue };
