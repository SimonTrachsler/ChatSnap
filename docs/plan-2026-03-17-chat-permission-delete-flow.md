# Plan: Chat Permission Errors + Account Delete Flow (2026-03-17)

## Scope

Fix exactly these two issues without weakening backend security rules:

1. New-account chat permission errors (`Only friends can open a chat.`) during normal navigation.
2. Account deletion flow causing chat-route/runtime errors around `loadThreadAndMessages`.

No implementation is performed in this plan file yet.

---

## Issue 1: New Account / Chat Permission Error

### Observed behavior

- App logs:
  - `[chat] getOrCreateThread error: {"code":"P0001","message":"Only friends can open a chat."}`
  - `[chat] loadThreadAndMessages error: {"code":"P0001","message":"Only friends can open a chat."}`
- This occurs for newly created accounts during normal app usage.

### Likely root causes

1. `getOrCreateThread` is called directly from chat screens based on route param (`friendId`) without a friendship guard.
2. Chat routes can be stale across auth/session transitions (old `userId` in route state), so a new account can land on a non-friend chat target.
3. Error logging is duplicated (library + screen), which amplifies noisy console output.

### Files to inspect/change

- `C:\dev\ChatSnap\src\lib\chat.ts`
- `C:\dev\ChatSnap\app\(tabs)\inbox\chat\[userId].tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\chat\[userId].tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\index.tsx` (guard consistency check, minimal if needed)

### Planned implementation

1. Add a lightweight friendship pre-check helper in `src/lib/chat.ts` (query `friends` relation for current user and target user).
2. In both chat route screens, validate route/user state before loading:
   - normalize `userId` param (`string` only),
   - reject self-chat and missing IDs,
   - short-circuit if current user is missing.
3. Before calling `getOrCreateThread`, run the friendship pre-check:
   - if not friends, handle gracefully in UI and navigate back to safe screen (`/(tabs)/inbox` or `/(tabs)/friends`).
4. Add stale async guards (cancellation flag / request token) so pending loads do not set state after auth/session/route changes.
5. Keep backend rule intact (`Only friends can open a chat`) and avoid invalid frontend calls.

---

## Issue 2: Account Delete Flow Error

### Observed behavior

- During/after delete-account flow, errors still appear from chat screen stack (`inbox/chat/[userId].tsx`, `loadThreadAndMessages`).
- Indicates stale chat state/subscriptions/routing still active while auth/user is being removed.

### Likely root causes

1. Delete flow currently signs out and redirects, but does not explicitly tear down chat runtime state before/after deletion.
2. Active chat screen/subscriptions may still run briefly during account removal and auth transition.
3. Chat screens do not fully guard against stale auth/route transitions during destructive account operations.

### Files to inspect/change

- `C:\dev\ChatSnap\app\(tabs)\settings.tsx`
- `C:\dev\ChatSnap\src\lib\supabase.ts`
- `C:\dev\ChatSnap\src\store\useActiveThreadStore.ts` (if reset helper needed)
- `C:\dev\ChatSnap\app\(tabs)\inbox\chat\[userId].tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\chat\[userId].tsx`
- `C:\dev\ChatSnap\app\_layout.tsx` (only if minimal auth-transition cleanup is required)

### Planned implementation

1. Introduce a small client-side cleanup routine for session transitions (logout/delete):
   - clear active thread state,
   - remove realtime channels/subscriptions,
   - invalidate chat-thread cache.
2. Invoke cleanup in settings logout/delete success path around sign-out + redirect.
3. Ensure chat screens stop work immediately when auth/user becomes invalid.
4. Keep logs useful but reduce repeated noise for known permission-session transition states.

---

## Validation / Test Plan

### A) New account onboarding without chat permission errors

1. Create a brand-new account.
2. Navigate across tabs (Camera, Friends, Inbox, Gallery, Settings).
3. Confirm no `P0001 Only friends can open a chat` error appears in console.
4. Open a real friend chat and verify thread/messages still load correctly.
5. Attempt non-friend chat route scenario (stale/deep route) and verify graceful handling (no crash, no noisy RPC spam).

### B) Account delete flow robustness

1. Log in with an account that has chats/friends.
2. Open a chat thread, then switch to Settings and delete account.
3. Verify:
   - no chat stack errors during delete,
   - app signs out cleanly,
   - redirect to welcome/login is reliable,
   - no stale chat route keeps firing RPCs after deletion.
4. Create/login with another account immediately afterward and confirm clean startup.

### C) Regression checks

1. Normal logout + login still works.
2. Inbox list and chat open/send still work for valid friends.
3. No TypeScript or lint regressions.

Commands planned after implementation:

- `npm run lint`
- `npx tsc --noEmit`

---

## Exact next step after plan approval

Run and test immediately after I implement the approved changes:

```bash
npx expo start --tunnel --clear
```


