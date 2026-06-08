const { Worker } = require('bullmq');
const { redisConnection } = require('./queue');
const prisma = require('./db');

const MODEL_NAME = 'llama-3.3-70b-versatile';

const historyWorker = new Worker('ai-history', async (job) => {
    const {
        guest_session_id,
        input_text,
        output_text,
        operation_type,
        language,
        style,
        model,
        tokens_used,
        processing_time_ms,
        cached,
        status,
        operation_metadata
    } = job.data;

    // Safety guard: skip logging if no session ID
    if (!guest_session_id) {
        console.warn('[HISTORY WORKER] Skipping log — no guest_session_id provided.');
        return;
    }

    try {
        // Find or create User by guest_session_id (upsert)
        const user = await prisma.user.upsert({
            where: { guest_session_id },
            update: {},
            create: {
                guest_session_id,
                settings: {
                    create: {
                        preferred_language: language || 'English'
                    }
                }
            }
        });

        // Save the AI operation
        await prisma.aiOperation.create({
            data: {
                user_id:            user.id,
                input_text:         input_text || '',
                output_text:        output_text || '',
                operation_type:     operation_type || 'unknown',
                language:           language || null,
                style:              style || null,
                model:              model || MODEL_NAME,
                tokens_used:        tokens_used || null,
                processing_time_ms: processing_time_ms || null,
                cached:             !!cached,
                status:             status || 'success',
                operation_metadata: operation_metadata || null
            }
        });

        console.log(`[HISTORY WORKER] ✓ Logged "${operation_type}" for guest: ${guest_session_id.substring(0, 8)}...`);
    } catch (error) {
        console.error(`[HISTORY WORKER ERROR] Failed to save operation:`, error.message);
        throw error; // Let BullMQ retry
    }
}, { connection: redisConnection });

historyWorker.on('failed', (job, err) => {
    console.error(`[HISTORY WORKER] Job ${job?.id} permanently failed: ${err.message}`);
});

historyWorker.on('error', (err) => {
    console.error('[HISTORY WORKER ERROR] Worker connection issue:', err.message);
});

console.log('[BULLMQ] History Worker initialized — listening for ai-history jobs...');

module.exports = { historyWorker };
