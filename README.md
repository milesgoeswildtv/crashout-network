# CRASHOUT Network — v0.1.0 foundation

Mobile-first React + TypeScript + Vite hub for the CRASHOUT network. CRASHOUT is the shared identity and discovery layer; Poker, SHYST, REALMS, RITUALS, DEGEN and future destinations retain their own gameplay services and economies.

## Local development
- Node.js 20+
- `npm install`
- Copy `.env.example` to `.env.local` and set Supabase URL + anon key when configured.
- `npm run dev`
- `npm run typecheck` and `npm run build`

## Status
This is an initial frontend and database foundation. Authentication screens, server-side profile provisioning, friends, wallet transactions, purchases, and admin operations are not complete. No destination is represented as live without a verified integration.

Review `supabase/migrations/0001_initial.sql` before applying to a NEW Supabase project. Never expose service-role keys in browser code. Wallet and role mutations must be server-side, atomic, audited, and idempotent. Game currencies remain isolated.