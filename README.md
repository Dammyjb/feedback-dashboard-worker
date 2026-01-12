# PMinterproject

# Feedback Intelligence Worker

Prototype Cloudflare Worker that collects user feedback, renders a dashboard with filter highlights, and generates AI summaries.

## Features

- **Dashboard** with urgency, theme, value, and sentiment filters showing ~5 feedback entries per focus area.
- **Feedback collection page** to gather new responses.
- **AI insights bot** powered by Workers AI, with cached summaries in KV.
- **Workflow-style summary endpoint** that refreshes cached summaries on demand.

## Setup

```bash
cd worker
npm install
```

### Configure bindings

Update `wrangler.toml` with your Cloudflare account IDs:

- `FEEDBACK_DB` (D1)
- `SUMMARY_CACHE` (KV)
- `AI` (Workers AI)

### Create database schema and seed data

```bash
npm run db:setup
npm run db:seed
```

### Run locally

```bash
npm run dev
```

Navigate to:

- Dashboard: `http://localhost:8787/dashboard`
- Feedback form: `http://localhost:8787/feedback`

### Deploy

```bash
npm run deploy
```

## API Endpoints

- `GET /api/feedback` — filterable feedback list
- `POST /api/feedback` — submit feedback
- `GET /api/ai-summary` — cached AI summary with recommendations
- `GET /api/workflow/run` — refresh summary cache (workflow step)
