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
