const prisma = require('../db');

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
        const nameToSave = (authUser.name && authUser.name !== 'Test User') 
            ? authUser.name 
            : (existingUser?.name || 'Test User');

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

module.exports = {
    syncSession
};
