-- Enable Realtime for public.friend_requests so postgres_changes (INSERT/UPDATE) are broadcast.
alter publication supabase_realtime add table public.friend_requests;
