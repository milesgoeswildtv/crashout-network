# CRASHOUT Identity Platform — Architecture Decision Record

**Status:** Proposed foundation; implementation is gated on review and verification.  
**Owner:** CRASHOUT Network  
**Scope:** CRASHOUT hub, SHYST, REALMS, Poker, DEGEN, RITUALS, MMO and future first-party destinations.

## Decision

CRASHOUT is the canonical identity provider and account-control plane for the network. Each destination remains an independently deployed application with its own gameplay services, data model, economy and player profile.

Use the existing CRASHOUT Supabase project as the initial identity system. Evaluate and, after explicit production-readiness checks, adopt Supabase Auth's OAuth 2.1 / OpenID Connect server for first-party sign-in. OAuth clients must use Authorization Code + PKCE. Do not create a proprietary password system or pass long-lived service credentials through browsers.

Supabase currently documents its OAuth 2.1/OIDC server as **Public Beta**. Therefore the architecture is standards-based and designed to use it, but enabling it in production is a separate rollout gate—not an assumption. Keep the existing authenticated CRASHOUT sign-in operational while the OAuth server is tested in a non-production client.

## Identity model

- **CRASHOUT user:** one canonical auth.users.id (immutable subject) and CRASHOUT profile.
- **External identities:** Discord, Telegram and other verified login identities attached to the canonical user only after provider-side proof and explicit user action.
- **Destination account:** an independently owned player account in a destination. A destination link maps (game_key, external_player_id) to the canonical CRASHOUT user.
- **OAuth client:** a registered first-party application with exact redirect URIs, environment separation and least-privilege scopes.
- **Authorization:** identity is not authorization. Destination roles, moderation powers, entitlements and economy permissions remain server-validated and destination-scoped.

Never merge accounts by matching email, username, display name or user-supplied IDs. Existing-account linking must prove control of both accounts. New-account provisioning must be an explicit, idempotent flow.

## Target sign-in flow

1. A destination starts an OAuth 2.1 Authorization Code + PKCE flow against CRASHOUT.
2. CRASHOUT authenticates the user and displays the requesting application and requested scopes.
3. The user approves the request.
4. CRASHOUT returns a short-lived authorization code to the exact registered callback.
5. The destination exchanges the code using the PKCE verifier and validates the resulting issuer, audience/client, signature, expiry and scopes.
6. The destination maps the stable CRASHOUT subject (sub) to its local player record. It does not trust browser-supplied identity claims.
7. Refresh tokens are stored only in appropriately protected client/server storage, rotated, revoked on logout/account-security events, and never logged.

Use asymmetric JWT signing (for example ES256 or RS256) and publish verification keys through the provider's JWKS endpoint before relying on tokens across independently deployed services. Validate issuer, audience, expiry, not-before, signature, client and required scopes. Do not share the Supabase service-role key or JWT signing secret with destinations.

## Account linking is a separate capability

OAuth SSO answers “who is signing in?” It does not automatically prove that an existing SHYST account belongs to that CRASHOUT user.

Retain a distinct account-link operation for legacy destination accounts:
- user is authenticated to CRASHOUT;
- user separately authenticates to the destination account;
- destination server proves the destination account subject from its own authenticated session;
- a single-use, short-lived, destination-bound challenge is consumed server-to-server;
- the database enforces uniqueness and writes an audit event atomically;
- retries are idempotent or return a safe conflict; no silent account reassignment.

The current SHYST flow already uses a one-time token and a central Supabase Edge Function gateway. Treat it as a migration bridge, not the permanent SSO protocol. Keep the adapter credential server-side, destination-scoped, rotatable and out of browser code. Replace static shared-secret coupling with a documented signed service-to-service protocol when the gateway is hardened; do not weaken or bypass the current check.

## Service boundaries

- **CRASHOUT Auth:** authentication, canonical subject, provider identities, OAuth clients, consent, sessions and revocation.
- **CRASHOUT Network API / database:** profile, friends, network-level settings, destination registry, account-link mappings and audit trail.
- **Destination services:** game state, gameplay authorization, destination roles, balances, inventory and destination-specific data.
- **Integration gateway:** validates destination-specific server credentials/signatures and calls narrowly scoped database functions. Never expose service-role credentials to a destination or browser.
- **External providers:** Discord/Telegram identity proof is handled by a provider-supported flow and verified server-side before it is attached to the canonical account.

## Required security controls

- OAuth Authorization Code + PKCE; exact HTTPS redirect URI allowlists; separate OAuth clients for production and non-production.
- Asymmetric signing keys, JWKS verification, key-rotation runbook and overlap period.
- Short-lived access tokens; refresh-token rotation and revocation; secure session lifecycle.
- Explicit consent and least-privilege scopes. No implicit “all games can read everything” scope.
- Server-side authorization on every destination API; never trust user metadata or client-supplied role claims.
- RLS on exposed Supabase tables; private tables and privileged functions remain least-privilege. Audit every link, unlink, provider change, role change and privileged action.
- Rate limits, replay protection, idempotency, bounded request sizes and no tokens/secrets/PII in logs.
- Account recovery and provider-unlink safeguards; require a verified recovery method before removing the last login method.
- Automated tests for cross-account takeover, wrong client/audience, wrong issuer, expired/replayed code, revoked session, duplicate link, account reassignment, and destination isolation.

## Current implementation audit (2026-11-10)

### CRASHOUT Network
- main is a React + TypeScript + Vite application using @supabase/supabase-js.
- The account panel currently signs users in directly with Supabase Auth and exposes Discord and custom:telegram identity-link calls.
- The SHYST account-link UI calls start_destination_link, opens the registered destination with a one-time token in the URL fragment, and lists rows from game_links.
- Supabase migrations through 0014_destination_adapter_gateway are recorded as applied in the hosted project.
- Hosted destination_integrations currently marks SHYST ready and enabled, while Poker/REALMS/RITUALS/DEGEN are adapter_required and MMO is disabled. This SHYST status is not supported by a completed end-to-end link: the hosted game_links table currently has no SHYST rows.
- The app README still describes destination integrations as incomplete. Registry state, UI claims and actual verified capability need one source of truth.

### SHYST
- SHYST is a separate application with its own authenticated player identity. Its link endpoint derives the external player ID from the authenticated SHYST session; this is the correct trust boundary.
- worker/src/crashout-link.ts returns the exact “not configured on this server” 503 before contacting CRASHOUT if CRASHOUT_SHYST_ADAPTER_KEY is absent or shorter than 32 characters.
- The current SHYST GitHub Actions deploy workflow deploys Worker and Pages, but its explicit wrangler secret put steps cover Discord and Telegram secrets—not CRASHOUT_SHYST_ADAPTER_KEY. A manually configured Cloudflare secret should normally persist across Worker versions, but the workflow does not provision, rotate or verify this adapter secret.
- The deploy workflow verifies generic /api/health, but does not verify the adapter binding or execute a safe end-to-end link smoke test. This leaves a gap between “deployment succeeded” and “account linking works.”
- SHYST's wrangler.jsonc has APP_URL set to https://tournament-platform.pages.dev, while the production verification workflow defaults to https://tournament-platform-9fd.pages.dev. This origin mismatch must be reconciled from actual Cloudflare project configuration before changing redirects or allowlists.

### Hosted gateway
- complete-destination-link is active, verify_jwt=false, and validates a destination-specific SHA-256 adapter-key hash before calling the narrowly scoped complete_destination_link database function.
- The Edge Function accepts only an allowlisted game key, a 64-character one-time token and a bounded external player ID. It does not log the raw token, adapter key or external account ID.
- The current path is a static per-destination shared-secret gateway, not OAuth SSO. It is acceptable as a transitional server-to-server bridge if secret provisioning, rotation and runtime verification are fixed.
- The SQL linking function consumes a short-lived, hashed, one-time token and writes an audit row. The deployed flow still needs explicit uniqueness, conflict, idempotency and ownership-proof regression tests.

## Delivery plan and gates

### Phase 0 — Baseline and stop the false-green state
- Keep current production auth untouched.
- Reconcile the SHYST Pages origin and API deployment target.
- Add a safe server-side readiness diagnostic that reports booleans only (never secret material), and a CI assertion that fails if the expected adapter binding is absent.
- Do not advertise SHYST linking as ready until the real production link and duplicate/replay tests pass. Do not disable or rotate production credentials blindly.

### Phase 1 — Identity-provider pilot
- Verify the current Supabase OAuth Server beta status, signing-key requirements, redirect behavior, client registration, token claims and revocation behavior.
- Build the CRASHOUT authorization/consent UI and register a separate SHYST staging client with exact callback URLs.
- Implement the destination callback and token validation using standards-compliant OIDC libraries; no custom JWT parsing.
- Run staging tests, security tests and mobile browser tests before any production client is enabled.

### Phase 2 — SHYST migration
- Keep existing SHYST accounts and player IDs.
- Link each SHYST player to a CRASHOUT subject through an explicit dual-proof process.
- Support CRASHOUT SSO for new sessions while retaining a carefully managed legacy recovery path during migration.
- Verify login, logout, token refresh, unlink, account recovery, cross-account isolation and rollback.

### Phase 3 — Reusable destination integration kit
- Publish one versioned contract and reference implementation for every destination.
- Register a distinct OAuth client and service identity per destination and per environment.
- Require conformance tests and health checks before a destination can be marked ready.
- Roll out Poker, REALMS, DEGEN, RITUALS and MMO one at a time; never mark a destination live from registry configuration alone.

## Acceptance criteria for production

A destination is not ready until all of the following are demonstrated in automated production-safe or staging tests:
1. Existing user signs in through CRASHOUT and reaches the correct local player account.
2. New user can be provisioned without duplicate or orphan accounts.
3. Tokens are verified server-side for signature, issuer, audience/client, expiry and scopes.
4. Wrong-client, expired, replayed, revoked and malformed credentials are rejected.
5. Linking cannot attach another person's destination account or reassign an existing mapping.
6. Logout/revocation and account recovery behave as documented.
7. CI verifies the deployed service identity/configuration without printing secrets.
8. Mobile browser QA and deployment evidence are attached to the release.

## Explicit non-goals

- No shared game database or cross-game currency.
- No forced migration of all destination gameplay/auth code in one release.
- No password storage or custom cryptographic protocol built by CRASHOUT.
- No trust in email/username matching as proof of account ownership.
- No production OAuth beta enablement until the pilot passes its gates.
