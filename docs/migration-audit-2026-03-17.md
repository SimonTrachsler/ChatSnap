# Supabase Migration Audit (2026-03-17)

Total migrations reviewed: **53**

## High-risk / Needs care

1. `20260229100001_full_reset_truncate.sql`
   - Truncates `public.profiles` (and related tables).
   - This can break username login if used without auth/profile backfill.
   - Keep for intentional resets only.

2. `20250216110000_profiles_table_and_trigger_standalone.sql`
   - Legacy bootstrap script that reintroduces broad profile read policy and older trigger behavior.
   - Should not be used as a normal production migration anymore.

## Legacy / Redundant (historical evolution)

The following objects are intentionally redefined multiple times across migration history:
- `handle_new_auth_user` (5x)
- `accept_friend_request` (4x)
- `friend_requests_receiver_update_only_status` (6x)
- `profiles_get_email_by_username` (3x)
- `search_profiles` (2x)

This is acceptable in append-only migration history, but these files are historical and not all are "current design".

## Security/privacy note

- `20260216100016_rls_profiles_friend_requests_friends.sql` creates `profiles_select_public` with `using (true)`.
- This is functional for social features but broad from a privacy perspective.
- If stricter privacy is desired, replace with `self-or-friend` policy plus RPC-only discovery/search.

## Improvements applied now

1. `20260317123000_full_wipe_and_auth_username_hardening.sql`
   - Full auth wipe capability.
   - Case-insensitive username uniqueness (`profiles_username_lower_uq`).
   - Username normalization trigger.
   - Hardened `handle_new_auth_user` with collision fallback.

2. `20260317124500_drop_legacy_friends_old.sql`
   - Removes legacy `friends_old` table.

3. `supabase/functions/admin-reset/index.ts`
   - Reliable recursive storage cleanup.
   - Safe all-users deletion loop (`page:1` re-fetch pattern).
   - Returns detailed deletion stats (`bucketStats`).

## Recommendation

Do not delete old migration files that are already applied remotely.
Instead, treat legacy migrations as historical record and keep latest hardening migrations authoritative.

