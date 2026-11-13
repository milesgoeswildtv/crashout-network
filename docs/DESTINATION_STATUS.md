# Live destination integration status

**Checked:** 2026-11-13  
**Authority:** hosted Crashout Supabase registry, hosted Edge Function inventory, connected Cloudflare deployment metadata, and destination repository source.  
**Rule:** a destination is not enabled merely because its app exists, an OAuth client exists, or a browser-side identity helper exists. It must pass its own server-side identity and launch verification.

## Shared identity model

- Crashout Supabase Auth owns the canonical user identity (auth.users.id).
- The Crashout profile owns the permanent network Player ID and public identity.
- Each destination keeps its own player/account ID, gameplay records, permissions, and economy.
- game_links maps one Crashout user to one verified external player ID per destination.
- Email, username, display name, and matching provider handles are never account-ownership proof.
- A destination's server adapter proves ownership and calls the private Crashout gateway. Browser clients never receive adapter credentials or the Supabase service-role key.
- Shared progression is accepted only through trusted destination events; it does not imply shared currency or cross-game balances.

## Hosted registry snapshot

| Destination | Registry state | Enabled | Launch URL | Integration assessment |
|---|---|---:|---|---|
| SHYST | ready | yes | https://tournament-platform-9fd.pages.dev | OIDC sign-in and server-side identity claim/resolve path are deployed. One existing account mapping is present in the hosted database; the atomic claim function returns an idempotent success for that same mapping. |
| CRASHOUT POKER | adapter_required | no | — | Destination-side OIDC bridge exists in the Poker rebuild source and the production Worker has the required secret bindings by name. The central Poker adapter credential/client configuration and a deployed end-to-end round trip are not yet verified. |
| REALMS | adapter_required | no | — | The platform has a Crashout browser identity client and link-request UI, but the destination server adapter, stable external player provisioning, ownership proof, and launch-token handoff are not complete. |
| RITUALS | adapter_required | no | — | A destination app/Worker exists; no verified Crashout identity adapter and end-to-end account-link flow is recorded. |
| DEGEN | adapter_required | no | — | A Pages destination exists; no verified Crashout identity adapter and end-to-end account-link flow is recorded. |
| MMO | disabled | no | — | Planned destination; no integration is claimed. |

The registry is the runtime source of truth. Do not manually mark a row ready to make a card clickable. A ready row must include an approved HTTPS launch URL and a verified destination adapter.

## Current hub behavior

- The Network cards read destination_integrations.
- A card launches only when its registry row is enabled, marked ready, and contains a launch URL.
- Launching a destination is distinct from linking its local account.
- The Account screen shows destination link state. SHYST currently exposes the legacy one-time link request only where the registry allows it; SHYST's preferred ongoing sign-in is OIDC.
- Poker's account-link action is destination-initiated through its OIDC bridge; do not invent a browser-side adapter secret or use the old generic link token for Poker.

## Backend and verification state

- Hosted Crashout Supabase project: qcmfnkuyinhfdxnuvneb, active/healthy.
- Hosted migrations are applied through the unified destination identity claim migration (the repository's 0017_unified_destination_identity_claim.sql).
- That migration makes the one-time link completion RPC delegate to the same atomic, idempotent claim function used by OIDC. The live function privileges were checked: only service_role can execute it.
- The live idempotency check for the existing SHYST mapping returned already_linked: true without creating a second mapping.
- claim-destination-identity, resolve-destination-identity, and complete-destination-link Edge Functions are active.
- Crashout Network's main deployment at commit 67b0d67 completed successfully on Cloudflare Pages. GitHub CI passed clean migration application, database security regression tests, typecheck, migration checks, build, adapter authentication tests, and gateway typechecks.

## Poker activation gates

Before enabling Poker in the registry, verify all of the following in the hosted environment:

1. The central claim-destination-identity function has CRASHOUT_OIDC_CLIENT_ID_POKER set to the exact registered Poker OAuth client ID.
2. The central function has CRASHOUT_POKER_ADAPTER_KEY_SHA256 set to the lowercase SHA-256 digest of the exact key held only by the Poker Worker.
3. The Poker Worker is deployed with the matching OAuth client ID/secret and adapter key.
4. The exact deployed Poker callback URI is registered in the Crashout OAuth client.
5. A disposable test player completes both existing-account linking and returning OIDC sign-in; duplicate ownership, wrong nonce/audience, replay, and disabled-destination cases fail closed.
6. The hub launch URL is confirmed against the actual production Poker deployment.
7. Only after those checks pass should Poker be changed to ready/enabled with its approved launch URL.

## Remaining destinations

Each remaining destination needs a server-owned stable player ID, explicit existing-account proof or idempotent account creation, a unique adapter credential, an approved launch URL, and end-to-end tests. REALMS currently has only the browser identity client; it does not yet meet the server-adapter gate. RITUALS and DEGEN must be audited against their current production source before any registry changes.

**Never promote a destination based on a green frontend build alone.**