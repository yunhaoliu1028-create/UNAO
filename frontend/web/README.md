# Unao Web (Next.js)

Estimate PDF -> consumable invoice editor prototype in Next.js App Router.

## Quick Start

1. Install Node.js 20+.
2. In `frontend/web` run:
   - `npm install`
   - `npm run dev`
3. Open `http://localhost:3000/estimates/new`

## API Integration

- Configure `.env.local` with:
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
  - `OPENAI_API_KEY=your_key_here` (optional, used on server route for better operation extraction)
  - `OPENAI_MODEL=gpt-4o-mini` (optional)
- Generate step calls:
  - `POST /v1/invoices/generate`
- Parse enhancement calls:
  - `POST /v1/estimates/analyze`
- If API is unavailable, UI falls back to local rule-based generation.

## Local Validation Flow

1. Start dev server with `.env.local` configured.
2. Open `http://localhost:3000/estimates/new`.
3. Upload a PDF and click `Parse Estimate`:
   - with `OPENAI_API_KEY`, parse status shows OpenAI-backed analysis;
   - without key, it falls back to local parser.
4. Choose `Tier (T1/T2/T3)` and click `Generate Consumable Lines`.
5. Verify generated lines are priced from `assets/material_info.csv` and selected by `assets/material_logic.csv`.
