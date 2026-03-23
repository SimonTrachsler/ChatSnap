-- Enable Realtime for user_photos so clients can subscribe to INSERT/DELETE
alter publication supabase_realtime add table public.user_photos;
