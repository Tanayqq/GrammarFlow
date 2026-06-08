const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const aiService = require('./services/ai.service');
const { aiHistoryQueue } = require('./historyQueue');

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
    const { prompt, text, temperature, guest_session_id, user_id, operation_type, language, style } = job.data;
    const startTime = Date.now();

    try {
        // Execute the AI processing using the existing service
        const response = await aiService.callGroqAPI(prompt, text, temperature);
        const processingTime = Date.now() - startTime;
        console.log(`[WORKER] Job ${job.id} completed successfully. (${processingTime}ms)`);

        // Queue history logging asynchronously — never block the response
        aiHistoryQueue.add('save-history', {
            guest_session_id:   guest_session_id || 'unknown',
            user_id:            user_id || null,
            input_text:         text,
            output_text:        response.text,
            operation_type:     operation_type || 'grammar_fix',
            language:           language || 'English',
            style:              style || null,
            model:              'llama-3.3-70b-versatile',
            cached:             response.source === 'cache',
            status:             'success',
            processing_time_ms: processingTime,
            operation_metadata: { temperature }
        }).catch(err => console.error('[WORKER] Failed to queue history:', err.message));

        // The return value is stored in Redis and accessible via job.returnvalue
        return response;
    } catch (error) {
        console.error(`[WORKER ERROR] Job ${job.id} failed:`, error.message);

        // Log failed operations too
        aiHistoryQueue.add('save-history', {
            guest_session_id:   guest_session_id || 'unknown',
            user_id:            user_id || null,
            input_text:         text,
            output_text:        '',
            operation_type:     operation_type || 'grammar_fix',
            language:           language || 'English',
            style:              style || null,
            cached:             false,
            status:             'failed',
            processing_time_ms: Date.now() - startTime,
            operation_metadata: { error: error.message }
        }).catch(() => {}); // Silent fail on history queue error

        throw error;
    }
}, { connection: redisConnection });

aiWorker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed with error: ${err.message}`);
});

aiWorker.on('error', (err) => {
    console.error('[BULLMQ WORKER ERROR] Worker encountered connection issue:', err.message);
});

console.log('[BULLMQ] Background Worker initialized and listening for jobs...');

module.exports = {
    aiWorker
};
