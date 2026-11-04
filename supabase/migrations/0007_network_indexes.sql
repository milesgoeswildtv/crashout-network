-- Query-path indexes for directory, social graph, inbox and admin views.
create unique index if not exists profiles_username_ci_unique
  on public.profiles (lower(username));
create index if not exists profiles_display_name_ci_idx
  on public.profiles (lower(display_name));
create unique index if not exists friendships_one_pair_unique
  on public.friendships (least(requester,addressee), greatest(requester,addressee));
create index if not exists friendships_addressee_pending_idx
  on public.friendships (addressee,created_at desc) where status='pending';
create index if not exists friendships_requester_accepted_idx
  on public.friendships (requester) where status='accepted';
create index if not exists friendships_addressee_accepted_idx
  on public.friendships (addressee) where status='accepted';
create index if not exists notifications_user_recent_idx
  on public.notifications (user_id,created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;
create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked);
