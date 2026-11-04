# First administrator bootstrap

The application intentionally has no client-side way to grant the first administrator role. New accounts receive only the `player` role. This prevents a user from promoting themselves through the browser.

After you have:
1. Created a Supabase project and configured the CRASHOUT app's Supabase URL and anon key.
2. Applied migrations `0001` through `0007` in numeric order.
3. Registered and confirmed the account that should own the network.

Open the Supabase SQL Editor using an owner-level project account. Replace the placeholder email below with the exact email used for that confirmed CRASHOUT account, then run:

```sql
update public.user_roles as r
set role = 'superadmin',
    granted_by = null,
    granted_at = now()
from auth.users as u
where r.user_id = u.id
  and lower(u.email) = lower('REPLACE_WITH_CONFIRMED_ACCOUNT_EMAIL')
returning r.user_id, r.role, r.granted_at;
```

Verify that exactly one row is returned and that its role is `superadmin`. If no row is returned, confirm the email, account confirmation, profile provisioning, and migration order before retrying. Do not insert a role for an arbitrary user ID.

The admin interface can then be opened by signing in with that account. The app allows an existing superadministrator to assign `player`, `moderator`, or `admin` roles to other players. Superadministrator grants and changes are deliberately disabled in the application; further superadministrator changes require a trusted database-owner operation.

Never put a Supabase service-role key in browser code, chat, or a public repository.
