const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { passiveAuth } = require('../middlewares/auth');

// Endpoint to sync authenticated user details and link previous guest history.
// Uses passiveAuth to parse token credentials.
router.post('/sync', passiveAuth, authController.syncSession);

// Email verification endpoints for Sign Up
router.post('/send-verification-code', authController.sendVerificationCode);
router.post('/verify-code', authController.verifyCode);

// Login verification check
router.post('/login', authController.login);

// Public Clerk configuration route
router.get('/config', authController.getAuthConfig);

module.exports = router;
