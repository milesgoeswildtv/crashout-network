# Crashout destination integration contract

## Current state
The central registry contains SHYST, CRASHOUT POKER, REALMS, RITUALS, DEGEN, and MMO. The migration seeds each entry as unavailable (adapter_required, or disabled for MMO). No destination is enabled and no launch URL is published by this migration.
A destination becomes available only after its own backend adapter has been implemented, deployed, and verified. Updating a registry row to ready and enabled=true is an operational release action, not a frontend toggle.

## Identity model
- Supabase Auth owns the central Crashout identity.
- profiles.id / auth.users.id is the stable Crashout user key.
- Each destination retains its own account ID, game data, rules, and economy.
- game_links maps one Crashout user to one external account per destination.
- Never merge or claim accounts based on matching email addresses, display names, or usernames.

## Link handshake
1. A signed-in player requests existing or create through start_destination_link(game_key, flow).
2. The RPC refuses the request unless the registry says the destination is enabled, ready, and has a launch URL.
3. Crashout returns a cryptographically random, single-use token with a ten-minute expiry. Only its SHA-256 hash is stored.
4. The destination completes its own proof: existing means authenticate the player and verify control of the exact destination account; create means create the destination account through its normal provisioning service.
5. Only after proof succeeds may the trusted destination server call complete_destination_link(token, external_player_id) using a server-side service-role credential.
6. The RPC consumes the token and creates game_links in one transaction. Unique constraints prevent duplicate account ownership. The operation is audited.
The browser must never receive a service-role key and cannot read link-session records or complete a link. Destination adapters must authenticate service-to-service calls and keep service-role credentials server-side.

## Release gates per destination
- Stable destination player ID exists.
- Existing-account ownership proof is implemented.
- New-account creation is idempotent and returns the stable player ID.
- Adapter validates and consumes the one-time Crashout token.
- Duplicate linking, expired tokens, replay attempts, and already-linked accounts fail safely.
- Full browser-to-destination round trip passes on the deployed origin.
- HTTPS launch URL belongs to the approved destination.

## Not included
This migration does not implement destination-specific adapters, create destination accounts, enable a destination, configure OAuth, or deploy itself to hosted Supabase. Those are separate verified steps for each destination.