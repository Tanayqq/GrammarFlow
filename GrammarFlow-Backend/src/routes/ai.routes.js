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

module.exports = router;
