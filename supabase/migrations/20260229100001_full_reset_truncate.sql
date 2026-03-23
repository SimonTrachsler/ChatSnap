-- Full reset: truncate all user-generated data. Run with service role or in SQL Editor.
-- Do NOT drop tables. Order respects FKs.
-- Run this BEFORE invoking admin-reset Edge Function (storage + auth deletion).

TRUNCATE public.friend_aliases CASCADE;
TRUNCATE public.chat_messages CASCADE;
TRUNCATE public.chat_threads CASCADE;
TRUNCATE public.snaps CASCADE;
TRUNCATE public.user_photos CASCADE;
TRUNCATE public.friends CASCADE;
TRUNCATE public.friend_requests CASCADE;
TRUNCATE public.profiles CASCADE;
