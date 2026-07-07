const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { aiCacheCheck } = require('../middlewares/cacheCheck');
const { aiLimiter, docLimiter, readLimiter } = require('../middlewares/rateLimiter');
const { passiveAuth } = require('../middlewares/auth');
const authRoutes = require('./auth.routes');

router.use('/auth', authRoutes);

// All AI operation routes include passiveAuth so req.userId is set when user is logged in.
// This ensures history is saved under the user's account, not just guest_session_id.
router.post('/rewrite',          passiveAuth, aiCacheCheck, aiLimiter, aiController.rewrite);
router.post('/grammar-fix',      passiveAuth, aiCacheCheck, aiLimiter, aiController.grammarFix);
router.post('/suggestions',      passiveAuth, aiCacheCheck, aiLimiter, aiController.suggestions);
router.post('/autocomplete',     passiveAuth, aiCacheCheck, aiLimiter, aiController.autocomplete);
router.post('/analyze-realtime', passiveAuth, aiCacheCheck, aiLimiter, aiController.analyzeRealtime);       // Phase 3 (sentence-level)
router.post('/analyze-smart',    passiveAuth, aiCacheCheck, aiLimiter, aiController.analyzeSmartSuggestions);  // Phase 4 (paragraph-level)
router.post('/process-document', passiveAuth, aiCacheCheck, docLimiter, aiController.processDocument);       // Phase 6 (Document/Image)

router.get('/job/:jobId',    readLimiter, aiController.checkJobStatus);   // Poll job status (GET)
router.post('/job/:jobId',   readLimiter, aiController.checkJobStatus);   // Poll job status (POST - extension support)
router.get('/history',       passiveAuth, readLimiter, aiController.getHistory);        // History (auth-aware)
router.get('/history/:id',   passiveAuth, readLimiter, aiController.getHistoryDetail); // Detail (auth-aware)

module.exports = router;
