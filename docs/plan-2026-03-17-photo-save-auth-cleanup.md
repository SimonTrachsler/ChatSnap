# Plan: Photo Save Warning, Multi-Device Auth, Full Cleanup Review

Date: 2026-03-17  
Mode: Planning only (no implementation until approval)

## A) Issues

1. Photo save warning spam:
   - `[photo-preview] storage_path missing in remote schema cache, retrying with legacy image_url`
2. Multi-device auth instability:
   - `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` on second device / parallel device usage
3. Full app cleanup pass:
   - runtime risk hotspots, defensive coding gaps, duplicate/legacy code, noisy logs

---

## B) Root Cause Summary (Likely / Confirmed)

### 1) Photo save warning

Confirmed mismatch between app write path and actual remote schema:
- App currently writes `user_photos.storage_path` first in [photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx), then falls back to `image_url`.
- Remote schema check (`supabase db query --linked`) shows `public.user_photos` currently has:
  - `id`, `user_id`, `image_url`, `created_at`
  - **no `storage_path`**
- Therefore each save triggers expected first-attempt failure + fallback warning.

Why this exists even though migration history includes a storage_path migration:
- Migration history row exists, but current remote schema is not aligned with that expected shape (historical drift / changed migration content over time).

### 2) Multi-device auth error

Likely combined causes:
- Several code paths call `supabase.auth.signOut()` without scope options (default behavior can revoke broader session state), found in:
  - [src/lib/supabase.ts](/C:/dev/ChatSnap/src/lib/supabase.ts)
  - [app/(tabs)/settings.tsx](/C:/dev/ChatSnap/app/(tabs)/settings.tsx)
  - [app/(tabs)/_layout.tsx](/C:/dev/ChatSnap/app/(tabs)/_layout.tsx)
- Central recovery in `handleAuthSessionError()` signs out immediately; with stale refresh tokens this can cascade into repeated auth churn and noisy logs.
- `initAuthListener()` does immediate `getSession()` + `getUser()` validation; stale local token handling is functional but not yet fully de-duplicated for multi-device churn.
- `ensureProfileForUser()` currently upserts only `{ id, email }`; if schema constraints require normalized username, this can silently fail and increase post-auth inconsistency risk.

### 3) Cleanup review (pre-findings)

High-value cleanup targets identified:
- Legacy compatibility branches still in production flow:
  - `storage_path`/`image_url` compatibility code duplicated in [photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx) and [snapSend.ts](/C:/dev/ChatSnap/src/lib/snapSend.ts)
- Legacy route likely unused in current UX:
  - [app/auth.tsx](/C:/dev/ChatSnap/app/auth.tsx)
- Noisy non-essential logs in auth/login paths (dev logs + repeated warning paths)
- `ensureProfileForUser()` swallow-only async upsert (`.then(() => {})`) without meaningful failure handling

---

## C) Files to Inspect / Change

### Photo save warning
- [app/(tabs)/photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx)
- [src/lib/snapSend.ts](/C:/dev/ChatSnap/src/lib/snapSend.ts)
- [app/(tabs)/gallery.tsx](/C:/dev/ChatSnap/app/(tabs)/gallery.tsx)
- [src/types/database.ts](/C:/dev/ChatSnap/src/types/database.ts)
- New migration (safe schema alignment): `supabase/migrations/20260317xxxxxx_user_photos_schema_alignment.sql`

### Multi-device auth
- [src/lib/supabase.ts](/C:/dev/ChatSnap/src/lib/supabase.ts)
- [app/_layout.tsx](/C:/dev/ChatSnap/app/_layout.tsx)
- [app/(tabs)/settings.tsx](/C:/dev/ChatSnap/app/(tabs)/settings.tsx)
- [app/(tabs)/_layout.tsx](/C:/dev/ChatSnap/app/(tabs)/_layout.tsx)
- [src/store/useAuthStore.ts](/C:/dev/ChatSnap/src/store/useAuthStore.ts)

### Cleanup pass
- [app/auth.tsx](/C:/dev/ChatSnap/app/auth.tsx)
- [src/lib/uploadHelper.ts](/C:/dev/ChatSnap/src/lib/uploadHelper.ts)
- [src/lib/profileSearch.ts](/C:/dev/ChatSnap/src/lib/profileSearch.ts)
- [src/lib/discover.ts](/C:/dev/ChatSnap/src/lib/discover.ts)
- [src/components/ErrorBoundary.tsx](/C:/dev/ChatSnap/src/components/ErrorBoundary.tsx)

---

## D) Implementation Plan

### 1) Remove photo save warning cleanly
1. Add safe migration to align `user_photos` with runtime code path:
   - Ensure `storage_path` exists (`add column if not exists`).
   - Backfill `storage_path` from existing `image_url` where possible.
   - Keep `image_url` for compatibility (no destructive drop).
2. Update save path logic to use one canonical insert payload for aligned schema (no warning-first fallback path).
3. Keep gallery read logic compatible during transition; validate signed URL generation still works for both old and new rows.
4. Remove warning spam path after schema alignment is guaranteed.

### 2) Stabilize multi-device auth behavior
1. Replace broad sign-out calls with explicit local-safe behavior where appropriate (`scope: 'local'`) for invalid refresh token recovery.
2. Add de-duplicated invalid-token handling guard to avoid repeated sign-out loops and noisy logs.
3. Improve session recovery:
   - If refresh token is stale/invalid: clear broken local session deterministically, mark state, redirect to login/welcome once.
4. Harden `ensureProfileForUser()` with safe username fallback + explicit failure handling/logging.
5. Keep multi-device behavior predictable:
   - Device A should not crash/spam when Device B signs in/out.
   - Redirect only when actually required.

### 3) Focused cleanup (production-safe)
1. Identify and remove/retire clearly unused legacy route usage (`app/auth.tsx`) or convert to safe redirect shell.
2. Reduce noisy logs to actionable logs (keep error diagnostics, remove repetitive warnings).
3. Consolidate duplicated schema compatibility helpers in one shared utility where possible (minimal refactor).
4. Add defensive null guards in high-risk async boundaries found during review.

---

## E) Validation / Test Plan

### Photo save + gallery
1. Capture photo -> Save.
2. Confirm save success and **no storage_path warning** in console.
3. Open Gallery, verify new photo appears and preview/delete/send still work.
4. Verify older rows (if present) still render.

### Multi-device auth
1. Device A login (Account X) -> app stable.
2. Device B login same account concurrently.
3. Reopen/focus both devices:
   - no crash loops
   - no repeated invalid refresh token spam
   - graceful redirect only if token truly invalid locally
4. Explicit logout on one device does not cause uncontrolled auth churn on the other.

### Cleanup/regression
1. Run lint + typecheck.
2. Quick smoke: login/register, camera, save/send, gallery, friends, inbox, settings.
3. Confirm no behavior regressions from cleanup changes.

---

## F) Cleanup Review (recommended removals/improvements)

Recommended safe candidates:
- Legacy route cleanup:
  - [app/auth.tsx](/C:/dev/ChatSnap/app/auth.tsx) appears superseded by login/register flow.
- Remove warning-first fallback patterns after schema alignment:
  - [app/(tabs)/photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx)
  - [src/lib/snapSend.ts](/C:/dev/ChatSnap/src/lib/snapSend.ts)
- Tighten silent failure behavior:
  - [src/lib/supabase.ts](/C:/dev/ChatSnap/src/lib/supabase.ts) (`ensureProfileForUser`)
- Keep only useful logs, remove repetitive noise in auth/login save paths.

---

## G) Immediate Next Step After Approval

After approval, I will implement the plan and then you can run immediately with:

```bash
npx expo start --tunnel --clear
```

If schema migration is included in this implementation batch, I will also run:

```bash
npx supabase db push
```


