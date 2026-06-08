const { PrismaClient } = require('@prisma/client');

// Singleton pattern: prevents multiple Prisma instances in development hot-reloads
const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

prisma.$connect()
    .then(() => console.log('[PRISMA] Connected to Supabase PostgreSQL successfully.'))
    .catch((err) => console.error('[PRISMA ERROR] Failed to connect to database:', err.message));

module.exports = prisma;
