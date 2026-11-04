# Integration setup

Each game requires an owner-approved contract: canonical launch URL, account-link method, stable external player ID, verified server-to-server auth, supported event schema and operational owner.

Do not infer API routes from a frontend. Do not invent endpoints, credentials, game status, balances or stats. Until a contract is implemented and tested, show the destination as disconnected/development.

Discord OAuth account linking is distinct from bot integration. It requires a registered callback, server-side credentials, state/nonce validation and tested linking.