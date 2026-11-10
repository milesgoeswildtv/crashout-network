# CRASHOUT Identity Platform — Architecture Decision Record

**Status:** Proposed foundation; implementation is gated on review and verification.  
**Owner:** CRASHOUT Network  
**Scope:** CRASHOUT hub, SHYST, REALMS, Poker, DEGEN, RITUALS, MMO and future first-party destinations.

## Decision

CRASHOUT is the canonical identity provider and account-control plane for the network. Each destination remains an independently deployed application with its own gameplay services, data model, economy and player profile.

Use the existing CRASHOUT Supabase project as the initial identity system. Evaluate and, after explicit production-readiness checks, adopt Supabase Auth's OAuth 2.1 / OpenID Connect server for first-party sign-in. OAuth clients must use Authorization Code + PKCE. Do not create a proprietary password system or pass long-lived service credentials through browsers.

Supabase currently documents its OAuth 2.1/OIDC server as **Public Beta**. Therefore the architecture is standards-based and designed to use it, but enabling it in production is a separate rollout gate—not an assumption. Keep the existing authenticated CRASHOUT sign-in operational while the OAuth server is tested in a non-production client. The hosted project's OAuth Server toggle/client registrations have not yet been independently verified through the available project connection; do not assume the server is enabled.

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

Use asymmetric JWT signing (for example ES256 or RS256) and publish verification keys through the provider's JWKS endpoint before relying on tokens across independently deployed services. OIDC ID tokens require asymmetric signing; Supabase recommends asymmetric signing for OAuth verification generally. Validate issuer, audience, expiry, not-before, signature and client. Supabase's documented OAuth Server currently supports Authorization Code + PKCE and Refresh Token grants; it does not support client_credentials. Therefore this user sign-in protocol does not replace machine-to-machine authentication between destination services and the integration gateway. The third-party relying-party flow is custom client work; `supabase-js` supplies the CRASHOUT authorization/consent UI methods, not a complete third-party client SDK.

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
- Explicit consent. Important Supabase OAuth Server limitation: standard OIDC scopes (`openid`, `email`, `profile`, `phone`) control identity claims/UserInfo, not database/API access; custom scopes are not currently supported. OAuth access tokens otherwise carry normal authenticated-user data access plus `client_id`. Enforce per-client least privilege with dedicated RLS policies using `auth.jwt()->>'client_id'`, and enforce destination permissions again in each destination API. Never assume the consent scopes themselves restrict database access.
- Server-side authorization on every destination API; never trust user metadata or client-supplied role claims.
- RLS on exposed Supabase tables; private tables and privileged functions remain least-privilege. Audit every link, unlink, provider change, role change and privileged action.
- Complete a function-by-function SECURITY DEFINER authorization review and enable leaked-password protection before expanding the identity provider surface.
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

### Supabase security posture
- The live Supabase Security Advisor currently reports 22 exposed SECURITY DEFINER functions callable by authenticated users. Some may be intentional RPCs, but each must be reviewed for an explicit auth.uid()/role/ownership check; do not bulk-revoke them or switch them to SECURITY INVOKER without reviewing their contracts.
- The advisor also reports leaked-password protection disabled. Enable and test this Auth protection before broadening production sign-in or enabling the OAuth pilot.
- Three RLS-enabled tables have no policies: achievement_events, destination_link_sessions and player_reports. Their current migrations revoke direct client access and use trusted functions/service-role paths, so this appears deny-by-default by design; verify grants remain restricted as migrations evolve.

### Hosted gateway
- complete-destination-link is active, verify_jwt=false, and validates a destination-specific SHA-256 adapter-key hash before calling the narrowly scoped complete_destination_link database function.
- The Edge Function accepts only an allowlisted game key, a 64-character one-time token and a bounded external player ID. It does not log the raw token, adapter key or external account ID.
- The current path is a static per-destination shared-secret gateway, not OAuth SSO. It is acceptable as a transitional server-to-server bridge if secret provisioning, rotation and runtime verification are fixed.
- The SQL linking function consumes a short-lived, hashed, one-time token and writes an audit row. The hosted database already has unique indexes enforcing one destination account per CRASHOUT user per game and one CRASHOUT user per external destination account. Regression tests still need to prove the intended conflict responses, atomic token consumption, replay rejection, idempotent retries and dual-account ownership proof.

### Follow-up security review (live hosted database, 2026-11-10)
- The Security Advisor's 22 SECURITY DEFINER warning entries were inspected against live function definitions and grants. All 22 are executable by authenticated users but not anon; all reference auth.uid(). Admin/moderation functions additionally check admin/moderator/superadmin role membership, and user-facing functions scope mutations or reads to auth.uid(). This does not justify blanket revocation or conversion to SECURITY INVOKER. Keep the advisor warning open as a manual review item: test each authorization path with ordinary users, moderators, admins and unauthenticated callers, especially functions that rely on helper functions or ownership predicates rather than an explicit early guard.
- The three RLS-enabled/no-policy tables (achievement_events, destination_link_sessions, player_reports) have no grants to anon or authenticated in the live database; only postgres and service_role have table privileges. This is deny-by-default and appears intentional. Keep direct client grants absent and continue using narrow, guarded RPC/Edge Function paths.
- Leaked-password protection remains disabled in hosted Auth. The connected Supabase tools expose read-only project inspection and SQL, not the Auth password-security configuration control. This must be enabled and verified in the Supabase dashboard before the identity pilot expands; do not claim it is enabled.
- SHYST PR #13's full CI test job passed, including typechecks, unit tests, multiplayer integration tests, web build and phone-size browser tests. Cloudflare Pages produced a preview. Cloudflare Workers Builds for tournament-platform-api reported failure; the production deploy job was skipped because this was a pull-request run. Therefore there is no Worker deployment proof yet, and PR #13 must not be described as deployed or production-ready. The available GitHub check summary links to Cloudflare's build detail but does not expose the underlying build error through the connected GitHub API.

## Delivery plan and gates

### Phase 0 — Baseline and stop the false-green state
- Keep current production auth untouched.
- Reconcile the SHYST Pages origin and API deployment target.
- Add a safe server-side readiness diagnostic that reports booleans only (never secret material), and a CI assertion that fails if the expected adapter binding is absent.
- Do not advertise SHYST linking as ready until the real production link and duplicate/replay tests pass. Do not disable or rotate production credentials blindly.

### Phase 1 — Identity-provider pilot
- Verify the current Supabase OAuth Server beta status, signing-key requirements, redirect behavior, client registration, token claims and revocation behavior.
- Build the CRASHOUT authorization/consent UI using `supabase.auth.oauth.getAuthorizationDetails`, `approveAuthorization` and `denyAuthorization`; register a separate SHYST staging client with exact callback URLs. Before issuing tokens, add and test `client_id`-aware RLS policies so the SHYST OAuth client cannot inherit unrestricted direct-user database access.
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
