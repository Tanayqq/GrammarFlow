const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

router.post('/rewrite', aiController.rewrite);
router.post('/grammar-fix', aiController.grammarFix);
router.post('/suggestions', aiController.suggestions);
router.post('/autocomplete', aiController.autocomplete);
router.post('/analyze-realtime', aiController.analyzeRealtime);

module.exports = router;
