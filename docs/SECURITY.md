# Security checklist

- Configure email verification and recovery.
- Provision profiles and Player IDs server-side with uniqueness retries.
- Admin bootstrap must be private, one-time, audited; never expose a public role-grant endpoint.
- Role changes are server-only and audited.
- Wallet changes occur only in atomic server-side transactions with unique idempotency keys.
- Keep game currency namespaces isolated.
- Validate catalog prices and entitlements server-side.
- Test RLS as anonymous, player, moderator and admin.
- Never ship service-role or OAuth secrets to the browser.