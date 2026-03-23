-- Enable Realtime for public.messages so postgres_changes (e.g. INSERT) are broadcast.
alter publication supabase_realtime add table public.messages;
