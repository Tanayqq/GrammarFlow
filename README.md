# GrammarFlow

GrammarFlow is a web writing assistant with grammar correction, rewriting, suggestions, document processing, voice dictation, and writing history. The active application is the root Express backend and the frontend in `public/`.

## Project layout

- `server.js`, `src/`: API, authentication, PostgreSQL access, Redis queues and workers. AI calls (including Whisper dictation via `/api/v1/transcribe`) use Groq with `GROQ_API_KEY`.
- `public/index.html`, `public/app-v16.js`: currently served browser application.
- `public/editor.html`, `public/head-pointer.js`: Flow-State Editor with the hands-free head pointer (webcam, Android-standard earbuds via WebHID, or the helpers below).
- `helpers/head_bridge.py`: relays OpenTrack head tracking (e.g. GalaxyBudsClient for Galaxy Buds) to the editor. `helpers/airpods/`: AirPods head tracking for macOS 14+.
- `GrammarFlow-Extension/`: browser extension sources. Build store zips from this folder; they are not kept in the repo.

## Deployment

The backend runs on Render (`grammarflow-brain`), which auto-deploys from the GitLab mirror `gitlab.com/Tanayqq/grammarflowt` branch `main`; keep that branch in step with GitHub `main`. The frontend is the Vercel project `grammarflowt`, which serves `public/` and proxies `/api/*` to Render.

The previous native macOS/offline roadmap is historical; it does not describe this hosted application.

## Run

Use Node.js 22. Install with `npm ci` (which generates the Prisma client), then `npm start`. Configure the environment described in [DEPLOYMENT.md](DEPLOYMENT.md). PostgreSQL, Redis, and a Groq API key are required for the full application. Background workers start with the server.

Password accounts use server-signed 24-hour sessions. Clerk authentication is also supported when configured. Old unsigned mock tokens are rejected; existing password users must sign in again. Their database IDs and history are preserved.

## Verify

Start an isolated Redis instance, then run the tests:

```sh
docker run --rm -d --name grammarflow-test-redis -p 127.0.0.1:16379:6379 redis:7-alpine
npm test
docker stop grammarflow-test-redis
```

Set `TEST_REDIS_URL` to use a different test Redis address. These tests use synthetic accounts, mocked database/email boundaries, and a real Redis instance; they do not contact production services. GitHub Actions runs them against its own Redis service. The older root integration scripts require external services and are not part of `npm test`.
