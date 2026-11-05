-- Public avatar delivery with private per-player write paths.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('player-avatars','player-avatars',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "player avatars are publicly readable" on storage.objects;
create policy "player avatars are publicly readable" on storage.objects
 for select using(bucket_id='player-avatars');
drop policy if exists "players upload own avatar" on storage.objects;
create policy "players upload own avatar" on storage.objects
 for insert to authenticated with check(bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "players update own avatar" on storage.objects;
create policy "players update own avatar" on storage.objects
 for update to authenticated using(bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
 with check(bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "players delete own avatar" on storage.objects;
create policy "players delete own avatar" on storage.objects
 for delete to authenticated using(bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
