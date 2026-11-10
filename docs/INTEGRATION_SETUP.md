# Integration setup

Each game requires an owner-approved contract: canonical launch URL, account-link method, stable external player ID, verified server-to-server auth, supported event schema and operational owner.

Do not infer API routes from a frontend. Do not invent endpoints, credentials, game status, balances or stats. Until a contract is implemented and tested, show the destination as disconnected/development.

Discord OAuth account linking is distinct from bot integration. It requires a registered callback, server-side credentials, state/nonce validation and tested linking.

## Universal login providers

Crashout Network uses one Supabase Auth user (`auth.users.id`) and one permanent Player ID for every login method. Discord and Telegram are identity providers linked to that existing user; they must not create separate player profiles when connected from Account Settings.

### Discord

Enable Discord under Supabase Dashboard → Authentication → Sign In / Providers. Configure the Discord application callback URL shown by Supabase Auth. The app supports Discord OAuth sign-in and authenticated identity linking. In Account Settings, use **Connect** to attach Discord to the currently signed-in Crashout account.

### Telegram (OIDC)

Telegram supports standard OpenID Connect login. In Telegram, open **@BotFather**, select or create the bot for Crashout, open **Login Widget**, switch to **OpenID Connect Login** if prompted, and register this exact redirect URI:

`https://qcmfnkuyinhfdxnuvneb.supabase.co/auth/v1/callback`

Copy the Client ID and Client Secret from BotFather. In Supabase Dashboard → Authentication → Sign In / Providers → Custom OAuth Providers, create a provider with:

- Provider type: **OIDC**
- Identifier: `custom:telegram`
- Display name: `Telegram`
- Client ID: the BotFather Client ID
- Client Secret: the BotFather Client Secret
- Issuer URL: `https://oauth.telegram.org`
- Scopes: `openid profile`
- Email optional: **enabled**, because Telegram does not provide an email address

Save and enable the provider. The Crashout app's Telegram sign-in and Account Settings linking buttons use `custom:telegram`.

### Linking rules and release checks

- To attach Discord or Telegram to an existing Crashout account, sign into that account first and use Account Settings → Login Methods → Connect.
- A provider already attached to another Crashout account must not be silently transferred or merged.
- Telegram identity is keyed by its stable OIDC subject, not its username or display name.
- Telegram email is optional; do not use email matching to identify or merge Telegram accounts.
- After enabling Telegram, verify a new Telegram sign-in provisions one profile and permanent Player ID, then link the same Telegram identity to a pre-existing test account and verify it returns to that same Player ID.
- Test Discord sign-in and linking separately. A successful provider redirect alone is not proof that the account link completed.
