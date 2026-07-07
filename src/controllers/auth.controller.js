const prisma = require('../db');
const { redisConnection } = require('../queue');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

const memoryOtpStore = new Map();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generates a stable mock user ID from an email address.
 * This ensures the same user always gets the same ID across sessions.
 */
const getMockUserId = (email) => {
    return 'mock_user_' + Buffer.from(email.toLowerCase()).toString('hex').substring(0, 16);
};

/**
 * Controller to handle profile syncing and session migration.
 */
const syncSession = async (req, res) => {
    try {
        const { guestSessionId } = req.body;
        const authUser = req.user; // populated by passiveAuth middleware

        if (!authUser || !req.userId) {
            return res.status(401).json({
                success: false,
                error: { message: "Authentication is required to sync sessions.", code: "UNAUTHORIZED" }
            });
        }

        console.log(`[AUTH CONTROLLER] Syncing session. User ID: ${req.userId} | Guest Session: ${guestSessionId || 'none'}`);

        // 1. Upsert the authenticated User record
        const existingUser = await prisma.user.findUnique({ where: { id: req.userId } });

        // Name priority: Clerk-provided name > existing DB name (only if not the stale 'Test User') > email prefix > 'User'
        const emailPrefix = authUser.email ? authUser.email.split('@')[0] : null;
        const clerkName = (authUser.name && authUser.name !== 'Test User') ? authUser.name : null;
        const storedName = (existingUser?.name && existingUser.name !== 'Test User') ? existingUser.name : null;
        const nameToSave = clerkName || storedName || emailPrefix || 'User';

        const dbAuthUser = await prisma.user.upsert({
            where: { id: req.userId },
            update: {
                email: authUser.email,
                name: nameToSave
            },
            create: {
                id: req.userId,
                email: authUser.email,
                name: nameToSave
            }
        });

        // 2. If guestSessionId is provided, link historical data
        if (guestSessionId) {
            // Find the guest user in DB
            const dbGuestUser = await prisma.user.findUnique({
                where: { guest_session_id: guestSessionId }
            });

            // If the guest user exists and is not already the same record as the authenticated user
            if (dbGuestUser && dbGuestUser.id !== dbAuthUser.id) {
                console.log(`[AUTH CONTROLLER] Migrating data from guest user "${dbGuestUser.id}" to auth user "${dbAuthUser.id}"`);

                await prisma.$transaction(async (tx) => {
                    // Migrate AI Operations
                    await tx.aiOperation.updateMany({
                        where: { user_id: dbGuestUser.id },
                        data: { user_id: dbAuthUser.id }
                    });

                    // Migrate or merge UserSettings
                    const guestSettings = await tx.userSettings.findUnique({
                        where: { user_id: dbGuestUser.id }
                    });

                    if (guestSettings) {
                        const authSettings = await tx.userSettings.findUnique({
                            where: { user_id: dbAuthUser.id }
                        });

                        if (!authSettings) {
                            // Link guest settings directly to the authenticated user
                            await tx.userSettings.update({
                                where: { user_id: dbGuestUser.id },
                                data: { user_id: dbAuthUser.id }
                            });
                        } else {
                            // Merge settings (prefer authSettings, fallback to guestSettings)
                            await tx.userSettings.update({
                                where: { user_id: dbAuthUser.id },
                                data: {
                                    preferred_theme: authSettings.preferred_theme || guestSettings.preferred_theme,
                                    preferred_language: authSettings.preferred_language || guestSettings.preferred_language
                                }
                            });
                            // Delete guest settings
                            await tx.userSettings.delete({
                                where: { user_id: dbGuestUser.id }
                            });
                        }
                    }

                    // Delete the old guest User record
                    await tx.user.delete({
                        where: { id: dbGuestUser.id }
                    });

                    // Update the authenticated User record to store the guest_session_id,
                    // so future requests with this header resolve to the authenticated user
                    await tx.user.update({
                        where: { id: dbAuthUser.id },
                        data: { guest_session_id: guestSessionId }
                    });
                });

                console.log(`[AUTH CONTROLLER] Migration transaction completed successfully.`);
            } else if (dbAuthUser.guest_session_id !== guestSessionId) {
                // If the guest user doesn't exist in DB, but we want to associate the guest_session_id with the authenticated user
                try {
                    await prisma.user.update({
                        where: { id: dbAuthUser.id },
                        data: { guest_session_id: guestSessionId }
                    });
                } catch (e) {
                    console.warn(`[AUTH CONTROLLER WARNING] Could not associate guest_session_id: ${e.message}`);
                }
            }
        }

        res.json({
            success: true,
            data: {
                message: "Authentication state synced and guest session linked successfully.",
                user: {
                    id: dbAuthUser.id,
                    email: dbAuthUser.email,
                    name: dbAuthUser.name
                }
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Sync session failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during session sync", code: "SERVER_ERROR" }
        });
    }
};

/**
 * Sends a 6-digit verification code to the designated email.
 */
const sendVerificationCode = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: { message: "Email is required." } });
        }
        
        const cleanEmail = email.trim().toLowerCase();
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ success: false, error: { message: "Invalid email format." } });
        }

        // Check if email is already registered
        const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (existingUser && existingUser.password_hash) {
            return res.status(409).json({
                success: false,
                error: { message: "An account with this email already exists. Please log in instead.", code: "EMAIL_EXISTS" }
            });
        }
        
        // Generate a 6-digit random code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Save in Redis if active, otherwise fallback to memory
        const redisKey = `gf:otp:${cleanEmail}`;
        let savedInRedis = false;
        if (redisConnection && redisConnection.status === 'ready') {
            try {
                await redisConnection.set(redisKey, code, 'EX', 300); // 5 minutes expiration
                savedInRedis = true;
            } catch (err) {
                console.error("[AUTH] Failed to save OTP in Redis:", err.message);
            }
        }
        
        if (!savedInRedis) {
            memoryOtpStore.set(cleanEmail, { code, expiresAt: Date.now() + 300 * 1000 });
        }
        
        console.log(`\n┌────────────────────────────────────────────────────────┐`);
        console.log(`│ [EMAIL VERIFICATION]                                   │`);
        console.log(`│ Verification code for: ${cleanEmail.padEnd(32)} │`);
        console.log(`│ Code: ${code.padEnd(48)} │`);
        console.log(`└────────────────────────────────────────────────────────┘\n`);
        
        let emailSent = false;
        // Try sending real email using nodemailer if configured
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });
                
                await transporter.sendMail({
                    from: `"GrammarFlow" <${process.env.SMTP_USER}>`,
                    to: cleanEmail,
                    subject: "Verify your GrammarFlow Email address",
                    text: `Your GrammarFlow verification code is: ${code}. This code is valid for 5 minutes.`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                            <h2 style="color: #8b5cf6; text-align: center;">GrammarFlow Email Verification</h2>
                            <p>Thank you for signing up for GrammarFlow. Please use the following 6-digit verification code to complete your signup process:</p>
                            <div style="font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; padding: 15px; background: #f3f4f6; border-radius: 8px; margin: 20px 0; color: #1f2937;">
                                ${code}
                            </div>
                            <p style="font-size: 12px; color: #6b7280; text-align: center;">This verification code is valid for 5 minutes. If you did not request this code, please ignore this email.</p>
                        </div>
                    `
                });
                console.log(`[AUTH] Real verification email successfully sent to ${cleanEmail}`);
                emailSent = true;
            } catch (mailErr) {
                console.error("[AUTH ERROR] Failed to send real verification email:", mailErr.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                message: "Verification code sent successfully.",
                // In dev/no-SMTP mode, tell the client the code was logged server-side
                devMode: !emailSent
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Send verification code failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during verification code delivery", code: "SERVER_ERROR" }
        });
    }
};

/**
 * Verifies a 6-digit code against Redis or memory store.
 */
const verifyCode = async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, error: { message: "Email and code are required." } });
        }
        
        const cleanEmail = email.trim().toLowerCase();
        const cleanCode = code.trim();
        
        let validCode = null;
        
        // Try getting from Redis first
        const redisKey = `gf:otp:${cleanEmail}`;
        if (redisConnection && redisConnection.status === 'ready') {
            try {
                validCode = await redisConnection.get(redisKey);
            } catch (err) {
                console.error("[AUTH] Failed to get OTP from Redis:", err.message);
            }
        }
        
        // If not found in Redis, check memory
        if (!validCode) {
            const memoryRecord = memoryOtpStore.get(cleanEmail);
            if (memoryRecord) {
                if (memoryRecord.expiresAt > Date.now()) {
                    validCode = memoryRecord.code;
                } else {
                    memoryOtpStore.delete(cleanEmail);
                }
            }
        }
        
        if (!validCode || validCode !== cleanCode) {
            return res.status(400).json({
                success: false,
                error: { message: "Invalid or expired verification code." }
            });
        }
        
        // Clean up code after success
        if (redisConnection && redisConnection.status === 'ready') {
            try {
                await redisConnection.del(redisKey);
            } catch (err) {
                console.error("[AUTH] Failed to delete OTP from Redis:", err.message);
            }
        }
        memoryOtpStore.delete(cleanEmail);
        
        res.json({
            success: true,
            data: {
                message: "Email successfully verified."
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Verify code failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during verification check", code: "SERVER_ERROR" }
        });
    }
};

/**
 * Registers a new user after OTP verification.
 * Creates the user in the database with a bcrypt-hashed password.
 */
const register = async (req, res) => {
    try {
        const { email, name, password } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({
                success: false,
                error: { message: "Email, name, and password are required." }
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanName = name.trim();

        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                error: { message: "Invalid email format." }
            });
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (existingUser && existingUser.password_hash) {
            return res.status(409).json({
                success: false,
                error: { message: "An account with this email already exists. Please log in.", code: "EMAIL_EXISTS" }
            });
        }

        // Hash the password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Generate a stable mock user ID from email
        const userId = getMockUserId(cleanEmail);

        // Upsert user (in case they were a guest before)
        const user = await prisma.user.upsert({
            where: { id: userId },
            update: {
                email: cleanEmail,
                name: cleanName,
                password_hash: passwordHash
            },
            create: {
                id: userId,
                email: cleanEmail,
                name: cleanName,
                password_hash: passwordHash
            }
        });

        console.log(`[AUTH CONTROLLER] Registered new user: ${cleanEmail} (ID: ${user.id})`);

        res.json({
            success: true,
            data: {
                message: "Account created successfully.",
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name
                }
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Register failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during registration", code: "SERVER_ERROR" }
        });
    }
};

/**
 * Logs in a user by verifying email and password.
 */
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: { message: "Email and password are required." } });
        }
        
        const cleanEmail = email.trim().toLowerCase();
        
        // Check database for existing user by email
        const user = await prisma.user.findFirst({
            where: { email: cleanEmail }
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: { message: "Account not found. Please Sign Up first.", code: "ACCOUNT_NOT_FOUND" }
            });
        }

        // If the user has no password_hash (e.g. old mock user or Clerk-only user)
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                error: { message: "This account was created with a different sign-in method. Please use Sign In with Clerk or reset your password.", code: "NO_PASSWORD" }
            });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: { message: "Incorrect password. Please try again.", code: "WRONG_PASSWORD" }
            });
        }
        
        // Password correct! Return user details
        res.json({
            success: true,
            data: {
                message: "Login successful.",
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name || 'User'
                }
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Login check failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during login check", code: "SERVER_ERROR" }
        });
    }
};

const getAuthConfig = async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        const key = (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim();
        res.json({
            success: true,
            data: {
                clerkPublishableKey: key || null
            }
        });
    } catch (error) {
        console.error("[AUTH CONTROLLER ERROR] Get auth config failed:", error.message);
        res.status(500).json({
            success: false,
            error: { message: "Internal server error during config retrieval", code: "SERVER_ERROR" }
        });
    }
};

module.exports = {
    syncSession,
    sendVerificationCode,
    verifyCode,
    register,
    login,
    getAuthConfig
};
