const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

router.post('/rewrite', aiController.rewrite);
router.post('/grammar-fix', aiController.grammarFix);
router.post('/suggestions', aiController.suggestions);
router.post('/autocomplete', aiController.autocomplete);
router.post('/analyze-realtime', aiController.analyzeRealtime);       // Phase 3 (sentence-level)
router.post('/analyze-smart', aiController.analyzeSmartSuggestions);  // Phase 4 (paragraph-level)
router.post('/process-document', aiController.processDocument);       // Phase 6 (Document/Image)
router.get('/job/:jobId', aiController.checkJobStatus);               // Poll job status (GET)
router.get('/history', aiController.getHistory);               // Retrieve paginated history for guest session
router.get('/history/:id', aiController.getHistoryDetail); // Retrieve detailed operation
router.post('/job/:jobId', aiController.checkJobStatus);              // Poll job status (POST support for extension background script)

module.exports = router;
