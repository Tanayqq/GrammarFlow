const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Setup Redis connection options for BullMQ
const redisConnection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

redisConnection.on('connect', () => {
    console.log('[REDIS QUEUE] Connected to Redis successfully.');
});

redisConnection.on('error', (err) => {
    console.error('[REDIS QUEUE ERROR] Connection failed:', err.message);
});

// Initialize the Queue named 'ai-jobs'
const aiQueue = new Queue('ai-jobs', { connection: redisConnection });

console.log('[BULLMQ] Queue "ai-jobs" initialized successfully.');

module.exports = {
    aiQueue,
    redisConnection
};
