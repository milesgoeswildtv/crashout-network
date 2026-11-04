# Architecture

CRASHOUT is the shared identity, social, discovery, and coordination layer. It does not replace the backend or gameplay systems of Poker, SHYST, REALMS, RITUALS, DEGEN, or the future MMO.

Shared: auth identity, immutable Player ID, username/display name, friends, notifications, directory. Per destination: gameplay state, rules, currency, balances, purchases, stats, and entitlements unless an approved integration contract explicitly defines otherwise.

Current: Vite + React + TypeScript mobile-first directory, gated Supabase client wiring, initial relational schema/RLS.

Next gates: auth/recovery; server-side collision-safe Player ID provisioning; private admin bootstrap; social workflows; atomic per-game wallet functions; verified game adapters; shop, achievements, leaderboards, notifications and admin UI.