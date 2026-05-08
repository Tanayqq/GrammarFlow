# GrammarFlow Full Cloud Deployment Guide

Follow these steps to make GrammarFlow accessible to anyone with a web link.

## 1. Deploy the Backend (The Brain)
**Host**: [Render.com](https://render.com) (Recommended)

1.  **Create a New Web Service** and connect your GitHub repository.
2.  **Settings**:
    - **Name**: `grammarflow-backend`
    - **Build Command**: `npm install`
    - **Start Command**: `npm start`
3.  **Environment Variables**:
    - `GROQ_API_KEY`: Your real API key.
    - `NODE_ENV`: `production`
4.  **Copy the URL**: Once live, copy your URL (e.g., `https://grammarflow-backend.onrender.com`).

## 2. Configure the Frontend
Before deploying the frontend, tell it where the backend is:

1.  Open `GrammarFlow-Web/app.js`.
2.  Paste your Render URL into the `PRODUCTION_API_URL` at the top:
    ```javascript
    const CONFIG = {
        PRODUCTION_API_URL: "https://grammarflow-backend.onrender.com",
        ...
    };
    ```

## 3. Deploy the Frontend (The Interface)
**Host**: [Vercel.com](https://vercel.com) (Recommended)

1.  **New Project**: Select "Add New" > "Project" on Vercel.
2.  **Import Repo**: Connect the same GitHub repository.
3.  **Configure**:
    - **Root Directory**: `GrammarFlow-Web`
    - **Framework Preset**: `Other`
4.  **Deploy**: Click "Deploy."
5.  **Result**: You will get a link like `https://grammarflow-web.vercel.app`.

## 4. Final Security Check
1.  Go to your **Render Backend Dashboard**.
2.  Add your new Vercel URL (e.g., `https://grammarflow-web.vercel.app`) to the `allowedOrigins` list in `server.js` if you want maximum security. (Currently, the backend allows local and browser extensions by default).

---
### You're Live!
Share your Vercel link with your friends on WhatsApp. It will now work on any phone or PC without them needing to install anything!
