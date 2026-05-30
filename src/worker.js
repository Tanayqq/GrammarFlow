const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const aiService = require('./services/ai.service');

// Setup Redis connection options for the Worker
let connectionOptions;

if (process.env.REDIS_URL) {
    connectionOptions = process.env.REDIS_URL;
} else if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        const host = process.env.UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '').split('/')[0];
        connectionOptions = {
            host: host,
            port: 6379,
            username: 'default',
            password: process.env.UPSTASH_REDIS_REST_TOKEN,
            tls: {}, // Enables TLS/SSL for rediss://
            maxRetriesPerRequest: null
        };
        console.log(`[REDIS WORKER] Derived TCP connection host: ${host}`);
    } catch (err) {
        console.error('[REDIS WORKER ERROR] Failed to derive TCP connection:', err.message);
    }
}

if (!connectionOptions) {
    connectionOptions = {
        host: '127.0.0.1',
        port: 6379,
        maxRetriesPerRequest: null
    };
}

const redisConnection = typeof connectionOptions === 'string'
    ? new IORedis(connectionOptions, { maxRetriesPerRequest: null })
    : new IORedis(connectionOptions);

// Initialize the Worker to process jobs from 'ai-jobs' queue
const aiWorker = new Worker('ai-jobs', async (job) => {
    console.log(`[WORKER] Starting job ${job.id} of type "${job.name}"...`);
    const { prompt, text, temperature } = job.data;

    try {
        // Execute the AI processing using the existing service
        const response = await aiService.callGroqAPI(prompt, text, temperature);
        console.log(`[WORKER] Job ${job.id} completed successfully.`);
        
        // The return value will be stored in Redis and accessible via job.returnvalue
        return response;
    } catch (error) {
        console.error(`[WORKER ERROR] Job ${job.id} failed:`, error.message);
        throw error;
    }
}, { connection: redisConnection });

aiWorker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed with error: ${err.message}`);
});

console.log('[BULLMQ] Background Worker initialized and listening for jobs...');

module.exports = {
    aiWorker
};
