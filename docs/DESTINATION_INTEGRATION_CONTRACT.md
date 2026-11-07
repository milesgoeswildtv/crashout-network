# Crashout destination integration contract

## Current state
The central registry contains SHYST, CRASHOUT POKER, REALMS, RITUALS, DEGEN, and MMO. All entries remain unavailable until their own adapter is implemented and verified. No destination is enabled and no launch URL is published by the registry migration.

## Identity model
- Supabase Auth owns the central Crashout identity.
- `auth.users.id` is the stable Crashout user key; `profiles.id` references it.
- Each destination retains its own account ID, game data, rules, and economy.
- `game_links` maps one Crashout user to one external account per destination.
- Never merge or claim accounts based on matching email addresses, display names, or usernames.

## Link handshake
1. A signed-in player requests an existing-account or create flow through `start_destination_link(game_key, flow)`.
2. The RPC refuses the request unless the registry says the destination is enabled, ready, and has a launch URL.
3. Crashout returns a cryptographically random, single-use token with a ten-minute expiry. Only its SHA-256 hash is stored.
4. The destination completes its own proof: existing means authenticate the player and verify control of the exact destination account; create means create the destination account through its normal provisioning service.
5. The destination server calls the central `complete-destination-link` Edge Function with its destination key, the one-time token, and the stable external player ID.
6. The gateway authenticates the adapter using a destination-specific secret. It selects the expected secret from the submitted game key, hashes the supplied secret, and compares it before invoking the database RPC.
7. The gateway alone holds the Supabase service-role key. Destination servers must never receive it. The database RPC also requires the token's stored game key to match the adapter game key and confirms the destination remains enabled.
8. The database consumes the token, creates `game_links`, and writes the audit record in one transaction. Existing unique constraints prevent duplicate account ownership.

## Gateway secrets
Configure one independently generated random secret per destination. Store only its lowercase SHA-256 hex digest in the corresponding Supabase Edge Function secret:
- `CRASHOUT_SHYST_ADAPTER_KEY_SHA256`
- `CRASHOUT_POKER_ADAPTER_KEY_SHA256`
- `CRASHOUT_REALMS_ADAPTER_KEY_SHA256`
- `CRASHOUT_RITUALS_ADAPTER_KEY_SHA256`
- `CRASHOUT_DEGEN_ADAPTER_KEY_SHA256`
- `CRASHOUT_MMO_ADAPTER_KEY_SHA256`

The plaintext secret belongs only in that destination's server-side secret store and must be sent in the `x-crashout-adapter-key` header over HTTPS. Never put it in browser code, a mobile app bundle, source control, or client-visible configuration. Rotate credentials by deploying a new digest and updating the destination server in a coordinated release. The gateway must return generic authentication errors and must not log secrets, tokens, or external account identifiers.

## Release gates per destination
- Stable destination player ID exists.
- Existing-account ownership proof is implemented and tested.
- New-account creation is idempotent and returns the stable player ID.
- A unique destination credential is provisioned server-side.
- The adapter calls the central gateway only after ownership proof or account creation succeeds.
- Duplicate linking, expired tokens, replay attempts, wrong-destination tokens, disabled destinations, and already-linked accounts fail safely.
- Full browser-to-destination round trip passes on the deployed origin.
- HTTPS launch URL belongs to the approved destination.

## Not included
The registry and gateway do not implement destination-specific ownership proof or account provisioning. They do not enable destinations, configure OAuth, or deploy themselves to hosted Supabase. Each adapter must implement and demonstrate its own proof and provisioning behavior before activation.
