const { Worker } = require('bullmq');
const { redisConnection } = require('./queue');
const prisma = require('./db');

const MODEL_NAME = 'openai/gpt-oss-120b';

// "Clear all" records when it happened, per owner (the signed-in user, or the guest session). A save that was queued
// before that moment is dropped, even if the queue only gets to it afterwards. Saves queued after it are kept.
// If Redis is unavailable this is skipped, and a save made in the last second before a clear can survive it.
const clearedKey = owner => `gf:histclear:${owner}`;

async function markHistoryCleared(owner) {
    if (!owner || !redisConnection || redisConnection.status !== 'ready') return;
    try { await redisConnection.set(clearedKey(owner), String(Date.now()), 'EX', 600); } catch { /* best effort */ }
}

async function clearedAfterQueued(data) {
    const owner = data.user_id || data.guest_session_id;
    if (!data.queued_at || !owner || !redisConnection || redisConnection.status !== 'ready') return false;
    try { return Number(await redisConnection.get(clearedKey(owner))) >= data.queued_at; } catch { return false; }
}

// Two first requests from a new guest can both try to create the same row: the loser hits the unique index.
// By then the row exists, so the same call simply finds it.
async function upsertUser(args) {
    try {
        return await prisma.user.upsert(args);
    } catch (error) {
        if (error.code !== 'P2002') throw error;
        return prisma.user.upsert(args);
    }
}

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
    if (await clearedAfterQueued(data)) return; // the history was cleared after this save was queued

    try {
        let user;
        if (user_id) {
            // Find or create User by authenticated user_id
            user = await upsertUser({
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
            user = await upsertUser({
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
        // Rethrown on purpose: the queue retries a failed job (3 tries), and callers that run this directly catch it.
        console.error(`[HISTORY ERROR] Failed to save operation:`, error.message);
        throw error;
    }
}

let historyWorker = null;
try {
    if (process.env.ENABLE_BACKGROUND_QUEUES === 'true') {
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
    }
} catch (workerErr) {
    console.warn('[BULLMQ] History worker initialization skipped:', workerErr.message);
}

module.exports = { historyWorker, logHistoryRecord, markHistoryCleared };
