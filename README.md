# DeviceGuard Prototype

This is a low-cost, testing-first prototype scaffold for DeviceGuard.

## What is included

- Static frontend for submitting a device analysis request
- Optional 1-3 image input encoded client-side as base64
- Vercel serverless API endpoint for Gemini analysis
- Strict JSON parsing with safe fallback behavior
- Optional Supabase logging for internal test review
- Simple internal log viewer at `/logs.html`
- Canonical test fixtures in `fixtures/canonical-cases.json`

## Stack choices

- Frontend: plain HTML/CSS/JS to keep complexity and cost low
- Backend: Vercel Node serverless functions
- AI: Gemini REST API
- Logging: Supabase REST API

## Recommended setup order

1. Install Node.js 20+ locally.
2. Copy `.env.example` to `.env.local`.
3. Start with `USE_MOCK_GEMINI=true`.
4. Open `index.html` with a local server or deploy to Vercel.
5. Once the UI and parser are stable, add your real Gemini key and set `USE_MOCK_GEMINI=false`.
6. Add Supabase env vars after the analysis flow is working.

## Supabase table

Create a table called `analysis_logs` with columns similar to:

- `id` uuid primary key default gen_random_uuid()
- `created_at` timestamptz default now()
- `input` jsonb not null
- `raw_model_response` text
- `parsed_result` jsonb
- `parse_status` text not null
- `model_version` text
- `latency_ms` int
- `estimated_cost` numeric

## Prototype testing workflow

1. Run with mocked Gemini responses first.
2. Validate the result page and fallback behavior.
3. Use the canonical cases in `fixtures/canonical-cases.json`.
4. Turn on real Gemini only after the parser and UI are stable.
5. Review logs in `/logs.html` during private testing.
