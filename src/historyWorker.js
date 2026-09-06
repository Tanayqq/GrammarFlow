const { Worker } = require('bullmq');
const { redisConnection } = require('./queue');
const prisma = require('./db');

const MODEL_NAME = 'openai/gpt-oss-120b';

async function logHistoryRecord(data) {
    const {
        guest_session_id,
        user_id,
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
    } = data;

    // Safety guard: skip logging if neither ID is provided
    if (!guest_session_id && !user_id) {
        return;
    }

    try {
        let user;
        if (user_id) {
            // Find or create User by authenticated user_id
            user = await prisma.user.upsert({
                where: { id: user_id },
                update: {},
                create: {
                    id: user_id,
                    settings: {
                        create: {
                            preferred_language: language || 'English'
                        }
                    }
                }
            });
        } else {
            // Find or create User by guest_session_id
            user = await prisma.user.upsert({
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
        }

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

        console.log(`[HISTORY] ✓ Logged "${operation_type}" for user/guest: ${(user_id || guest_session_id).substring(0, 8)}...`);
    } catch (error) {
        console.error(`[HISTORY ERROR] Failed to save operation:`, error.message);
    }
}

let historyWorker = null;
try {
    historyWorker = new Worker('ai-history', async (job) => {
        return logHistoryRecord(job.data);
    }, { connection: redisConnection });

    historyWorker.on('failed', (job, err) => {
        console.error(`[HISTORY WORKER] Job ${job?.id} permanently failed: ${err.message}`);
    });

    historyWorker.on('error', (err) => {
        if (!err.message?.includes('max requests limit exceeded')) {
            console.error('[HISTORY WORKER ERROR] Worker connection issue:', err.message);
        }
    });

    console.log('[BULLMQ] History Worker initialized — listening for ai-history jobs...');
} catch (workerErr) {
    console.warn('[BULLMQ] History worker initialization skipped:', workerErr.message);
}

module.exports = { historyWorker, logHistoryRecord };
