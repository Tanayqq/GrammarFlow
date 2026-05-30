const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Setup Redis connection options for BullMQ
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
        console.log(`[REDIS QUEUE] Derived TCP connection host: ${host}`);
    } catch (err) {
        console.error('[REDIS QUEUE ERROR] Failed to derive TCP connection:', err.message);
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
