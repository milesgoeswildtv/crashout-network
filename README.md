# CRASHOUT Network — v0.1.0 foundation

Mobile-first React + TypeScript + Vite hub for the CRASHOUT network. CRASHOUT is the shared identity and discovery layer; Poker, SHYST, REALMS, RITUALS, DEGEN and future destinations retain their own gameplay services and economies.

## Local development
- Node.js 20+
- `npm install`
- Copy `.env.example` to `.env.local` and set Supabase URL + anon key when configured.
- `npm run dev`
- `npm run typecheck` and `npm run build`

## Status
The frontend now includes Supabase authentication flows, server-side profile provisioning, player directory and friend requests, private notifications, public player profile cards, editable identity settings, and a restricted admin overview with audited role management. Wallet transactions, purchases, full moderation workflows, and destination integrations are not complete. Role changes are superadministrator-only; superadministrator grants are disabled. No destination is represented as live without a verified integration.

Review `supabase/migrations/0001_initial.sql` before applying to a NEW Supabase project. Never expose service-role keys in browser code. Wallet and role mutations must be server-side, atomic, audited, and idempotent. Game currencies remain isolated.

First administrator setup is documented in `docs/ADMIN_BOOTSTRAP.md`; the first superadministrator must be assigned through the trusted Supabase SQL Editor, never from the client.

## Migration discipline
Apply the SQL files once, in numeric order, to a new Supabase project. Do not skip migrations or apply them out of order. Back up an existing project before introducing these schema changes.

## Account setup
The account screens call Supabase Auth directly. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local environment or hosting provider. Apply every migration in order: `0001_initial.sql`, `0002_secure_player_provisioning.sql`, `0003_social_foundation.sql`, `0004_player_identity_settings.sql`, `0005_admin_foundation.sql`, `0006_public_player_profiles.sql`, and `0007_network_indexes.sql`. Configure Supabase email confirmation and allowed redirect URLs for the deployed origin. The database trigger provisions the profile, six-character Player ID, and default player role when an auth user is created. The client cannot set Player IDs or roles. Social actions run through authenticated database functions; direct client writes to friendship and notification tables are revoked.

The project does not contain Supabase project credentials. Until a project is configured and migrations are applied, the interface intentionally reports that account services are not connected.
