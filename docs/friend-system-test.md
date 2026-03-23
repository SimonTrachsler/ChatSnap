# Friend System – Test Checklist & Cleanup

## Running migrations

- From project root: `npx supabase db push` (or `supabase migration up`) with Supabase CLI linked to your project.
- Or run the SQL in `supabase/migrations/20260227100000_friend_system_pure_sql.sql` (pure SQL, no DO blocks) in the Supabase Dashboard → SQL Editor.

## Verify in Supabase

- **Table Editor → public.friends**: Columns must be `id`, `user_id`, `friend_id`, `created_at` (no `user_a`/`user_b`).
- **Table Editor → public.friend_requests**: Column `status` only values `pending`, `accepted`, or `declined`.
- **SQL Editor**: `select indexname from pg_indexes where tablename = 'friend_requests' and indexname = 'friend_requests_unique_pending_pair';` should return one row.
- **Database → Functions**: `accept_friend_request` should exist and be SECURITY DEFINER.

---

## Test checklist (2 accounts: acc1, acc2)

1. **acc1 sends request to acc2**
   - acc1: Friends → search acc2 username → send request.
   - **Expected**: acc1 sees "Anfrage gesendet" and the button is disabled (no second send).

2. **acc2 accepts**
   - acc2: Friends → Anfragen → accept acc1’s request.
   - **Expected**: Both acc1 and acc2 see each other under "My Friends" (refresh/list reload).

3. **Decline and re-request**
   - acc2: Decline another incoming request (or use a third account).
   - **Expected**: Request status becomes declined; requester can send a new request to that user later.

4. **Full flow again**
   - acc1 sends request to acc2; acc2 accepts.
   - **Expected**: Both lists refresh; the new friend appears immediately for both.

---

## One-time DB cleanup (optional, for a clean test)

Run in Supabase SQL Editor only if you want to wipe friend data for testing. This deletes all friend_requests and friends rows (and optionally the old backup table if it exists).

```sql
-- Optional: clean slate for friend system testing
delete from public.friend_requests;
delete from public.friends;
-- If migration created friends_old and you want to remove it:
-- drop table if exists public.friends_old;
```

Do not run in production if you need to keep existing friendships.
