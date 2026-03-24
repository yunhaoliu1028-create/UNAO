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
- Generate step calls:
  - `POST /v1/invoices/generate`
- If API is unavailable, UI falls back to local rule-based generation.
