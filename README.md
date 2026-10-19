# Call Compass

Call Compass is a caller-side guide for an eight-stage cold call. It keeps the caller oriented, shows the likely moments at each stage, captures the prospect's exact words, and stores a lightweight history of calls.

## Live links

- Frontend: https://call-compass-seven.vercel.app/
- Backend health: https://call-compass.onrender.com/health
- GitHub: https://github.com/MithunChevakula/Call-Compass

## Structure

- `frontend/` is a dependency-free static app suitable for Vercel.
- `backend/` is an Express API suitable for Render.
- `schema.sql` creates the Supabase `calls` and `stage_results` tables.

## Run locally

```bash
npm install
npm start
```

Open `frontend/index.html` in a browser. The default API is `http://localhost:8787`. For a deployed frontend, the app is configured for Vercel via [`vercel.json`](./vercel.json). Set `window.CALL_COMPASS_API` to the Render API URL before loading the app, or update the `API_BASE` constant in [`frontend/app.js`](./frontend/app.js).

## API

- `GET /health`
- `POST /calls` — `{ prospectName, company, callerName?, context? }`
- `POST /calls/:id/stages` — `{ stage, result, prospectWords }`
- `POST /calls/:id/close` — `{ outcome }`
- `POST /calls/:id/debrief`
- `GET /calls`

## Supabase and Render

Run [`schema.sql`](./schema.sql) in Supabase SQL Editor. On Render, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and use `npm start`; Render supplies `PORT`. The backend uses Supabase when both variables are present and an in-memory store for local preview otherwise. The service-role key must stay on Render and must never be placed in the frontend.

## LLM note

The product uses an LLM only for the post-call debrief endpoint: [`POST /calls/:id/debrief`](./backend/server.js). It summarizes the caller's captured stage notes into a concise debrief and stores the result on the call record. The model is configured server-side with `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`; when those variables are absent, the backend returns a deterministic fallback summary instead of blocking the call flow.

## Deploy

Import the repository into Vercel from the root; the rewrites in [`vercel.json`](./vercel.json) serve the caller screen from [`frontend/`](./frontend/). Deploy the Node service from the repository root on Render with [`render.yaml`](./render.yaml), and set the frontend API URL to the Render health/API origin.
