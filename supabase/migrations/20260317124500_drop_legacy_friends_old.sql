-- Cleanup: remove legacy table left from schema migration.
drop table if exists public.friends_old cascade;

