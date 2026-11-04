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

## Account setup
The account screens call Supabase Auth directly. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local environment or hosting provider. Apply migrations in order: `0001_initial.sql`, then `0002_secure_player_provisioning.sql`. Configure Supabase email confirmation and allowed redirect URLs for the deployed origin. The database trigger provisions the profile, six-character Player ID, and default player role when an auth user is created. The client cannot set Player IDs or roles.

The project does not contain Supabase project credentials. Until a project is configured and migrations are applied, the interface intentionally reports that account services are not connected.
