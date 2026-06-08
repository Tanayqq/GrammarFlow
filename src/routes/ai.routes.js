const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { aiCacheCheck } = require('../middlewares/cacheCheck');
const { aiLimiter, docLimiter, readLimiter } = require('../middlewares/rateLimiter');

router.post('/rewrite', aiCacheCheck, aiLimiter, aiController.rewrite);
router.post('/grammar-fix', aiCacheCheck, aiLimiter, aiController.grammarFix);
router.post('/suggestions', aiCacheCheck, aiLimiter, aiController.suggestions);
router.post('/autocomplete', aiCacheCheck, aiLimiter, aiController.autocomplete);
router.post('/analyze-realtime', aiCacheCheck, aiLimiter, aiController.analyzeRealtime);       // Phase 3 (sentence-level)
router.post('/analyze-smart', aiCacheCheck, aiLimiter, aiController.analyzeSmartSuggestions);  // Phase 4 (paragraph-level)
router.post('/process-document', aiCacheCheck, docLimiter, aiController.processDocument);       // Phase 6 (Document/Image)

router.get('/job/:jobId', readLimiter, aiController.checkJobStatus);               // Poll job status (GET)
router.post('/job/:jobId', readLimiter, aiController.checkJobStatus);              // Poll job status (POST support for extension background script)
router.get('/history', readLimiter, aiController.getHistory);               // Retrieve paginated history for guest session
router.get('/history/:id', readLimiter, aiController.getHistoryDetail); // Retrieve detailed operation

module.exports = router;
