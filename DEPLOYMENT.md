# GrammarFlow Deployment Guide

This document explains how to deploy GrammarFlow to a production environment.

## 1. Backend Deployment (e.g., Render, Railway, Heroku)

### Prerequisites
- A GitHub account.
- A Groq API Key.

### Steps
1. **Push to GitHub**: Push the `GrammarFlow-Backend` folder (or the whole repo) to a new GitHub repository.
2. **Connect to Hosting**:
   - On **Render.com**, create a new "Web Service" and link your repo.
   - Set the "Build Command" to `npm install`.
   - Set the "Start Command" to `npm start`.
3. **Environment Variables**: Add the following in your hosting dashboard:
   - `GROQ_API_KEY`: Your real API key.
   - `NODE_ENV`: `production`.
   - `PORT`: `3000` (or whatever the host provides).

## 2. Frontend Configuration

### For Hosted Web Usage
If you deploy the backend to `https://grammarflow.onrender.com`, the frontend is automatically served at that URL. No further steps are needed.

### For Extension / Standalone Usage
If you want a standalone HTML file to talk to your cloud backend:
1. Open `app.js` (or `GrammarFlow_Web.html`).
2. Update the `CONFIG.PRODUCTION_API_URL` variable:
   ```javascript
   const CONFIG = {
       PRODUCTION_API_URL: "https://grammarflow.onrender.com",
       // ...
   };
   ```

## 3. Scaling for Extension & Mobile
The backend is now client-agnostic. To support a Chrome Extension or Mobile App:
1. Use the `/api/v1` prefix for all requests.
2. Ensure you add the Extension ID or App Schema to the `allowedOrigins` list in `server.js` if you enable strict CORS.

## Security configuration for the root application

Before deploying this revision, configure:

- `SESSION_SECRET`: a securely generated random secret of at least 32 bytes, shared by every backend instance. For example, generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and store it only in the hosting environment. Missing or short secrets disable password session issuance; there is no default key. Rotation invalidates existing password sessions.
- `DATABASE_URL`: a PostgreSQL connection URL. TLS certificate and hostname verification are always enabled; URL parameters cannot disable them.
- `DATABASE_CA_CERT`: the provider's trusted PEM CA certificate when the database does not use a publicly trusted chain. Actual newlines or literal `\n` separators are accepted. Obtain the CA from the database provider. Do not disable certificate verification to work around a missing CA.
- `REDIS_URL` (or the existing Upstash connection settings): OTP verification and one-use registration proofs require available Redis. There is no insecure in-memory fallback for verification.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optionally `SMTP_PORT` and `SMTP_SECURE`: working email delivery. Sending a verification code fails if email cannot be delivered. Codes are not logged or returned to clients.

Register with `POST /api/v1/auth/send-verification-code`, then `/verify-code` with `{email, code}`. Pass the returned `data.verificationToken` to `/register` with `{email, name, password, verificationToken}`. The proof expires after five minutes and can only be used once for the verified email. Five incorrect OTP guesses invalidate the code. Codes can be requested once per email per five minutes.

Both `/register` and `/login` return `data.token`; send it as an Authorization Bearer token. Do not generate tokens in clients. Passwords must be at least eight characters and at most 72 UTF-8 bytes. Existing accounts keep their IDs; unsigned legacy sessions require a fresh login.

Authentication attempts share an IP-based quota (20 per 15 minutes). Guest AI requests also use normalized IPs, so changing a guest-session header does not reset a quota. Configure the hosting proxy correctly before relying on individual client IPs; this revision does not blindly trust forwarded headers.

This revision changes source only. Configure secrets/CA and verify email and database connectivity in staging before production deployment. No database schema migration is required.
