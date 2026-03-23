# Plan: Camera Overlay, Header Consistency, Friends Search Back Nav, Auth `.rest` Error

Date: 2026-03-17  
Scope: Planning only (no code changes until approval)

## 1) Issues

1. Camera preview shows a dark top band/overlay after taking a snap.
2. Page headings on Settings, Gallery, Inbox, Friends look inconsistent (size/alignment/placement).
3. Friends Search screen has no clear way back to the Friends tab.
4. After logout, login (especially username login) fails with `Cannot read property 'rest' of undefined`.

## 2) Root Cause Summary (Likely/Confirmed)

### Issue 1: Camera top dark overlay
- Confirmed in [app/(tabs)/photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx): explicit `topShade` layer is rendered over the image (`height: 180`, semi-transparent dark color).
- Camera screen also has dark top UI chips in [app/(tabs)/index.tsx](/C:/dev/ChatSnap/app/(tabs)/index.tsx) (`headerChip`, `switchBtn`) and preview offset math (`top: -insets.top`) that can visually exaggerate top contrast.

### Issue 2: Heading inconsistencies
- Primary source is shared header layout in [src/ui/components/PageHeader.tsx](/C:/dev/ChatSnap/src/ui/components/PageHeader.tsx): title sits in a flex row between left/right placeholders with asymmetric action widths, causing visual off-centering on screens with right actions (e.g. Friends).
- Secondary source is per-screen list/header spacing differences in the tab screens.

### Issue 3: Missing back button in Friends Search
- Confirmed in [app/(tabs)/friends/search.tsx](/C:/dev/ChatSnap/app/(tabs)/friends/search.tsx): no header/back action exists.

### Issue 4: Login `.rest` error after logout
- Root cause identified in [src/lib/supabase.ts](/C:/dev/ChatSnap/src/lib/supabase.ts): `callRpc` extracts `supabase.rpc` into a standalone function variable before calling it.
- This loses method context (`this`), and Supabase internals access `this.rest`, producing `Cannot read property 'rest' of undefined`.
- This impacts every `callRpc(...)` user (username login, discover, stats, chat RPC paths), but user-visible blocker is username login after logout.

## 3) Files to Inspect/Change

### Planned edits
- [app/(tabs)/photo-preview.tsx](/C:/dev/ChatSnap/app/(tabs)/photo-preview.tsx)
- [app/(tabs)/index.tsx](/C:/dev/ChatSnap/app/(tabs)/index.tsx)
- [src/ui/components/PageHeader.tsx](/C:/dev/ChatSnap/src/ui/components/PageHeader.tsx)
- [app/(tabs)/friends/search.tsx](/C:/dev/ChatSnap/app/(tabs)/friends/search.tsx)
- [src/lib/supabase.ts](/C:/dev/ChatSnap/src/lib/supabase.ts)

### Verify-only (no functional change expected unless needed)
- [app/(tabs)/friends/index.tsx](/C:/dev/ChatSnap/app/(tabs)/friends/index.tsx)
- [app/(tabs)/gallery.tsx](/C:/dev/ChatSnap/app/(tabs)/gallery.tsx)
- [app/(tabs)/inbox/index.tsx](/C:/dev/ChatSnap/app/(tabs)/inbox/index.tsx)
- [app/(tabs)/settings.tsx](/C:/dev/ChatSnap/app/(tabs)/settings.tsx)
- [app/login.tsx](/C:/dev/ChatSnap/app/login.tsx)

## 4) Implementation Steps

1. Camera top overlay cleanup
- Remove `topShade` view and related style from photo preview.
- Keep close button and bottom action bar intact.
- Validate top status area still readable; if needed, keep only button-local translucent background (not full-width band).
- Review camera preview wrapper offsets for top-edge correctness on iOS/Android.

2. Unified heading style and alignment
- Refine `PageHeader` so title is consistently centered and visually stable regardless of left/right action content.
- Slightly increase title size and normalize top/bottom spacing.
- Keep dark theme colors and current design language; no broad redesign.
- Verify appearance on Settings, Gallery, Inbox, Friends without per-screen hacks.

3. Friends Search back navigation
- Add a compact top bar/back button in search screen.
- Primary action: `router.back()`.
- Defensive fallback: route to `/(tabs)/friends` when no back history.

4. Auth `.rest` crash fix
- Fix `callRpc` to call the bound method directly (`supabase.rpc(...)`) instead of detached function references.
- Add a minimal defensive error log in login flow for RPC failures (message/code/status when present).
- Re-test username login flow after explicit logout and account switch.

5. Safety pass
- Typecheck/lint targeted files.
- Ensure no existing flows regress (camera capture, save/send, tab navigation, headings).

## 5) Testing Steps

### A) Camera overlay
1. Open Camera tab.
2. Take a snap.
3. Confirm no dark band at top of preview image.
4. Confirm close/save/send controls still work and are tappable.

### B) Headings
1. Open Friends, Inbox, Gallery, Settings tabs.
2. Check title alignment, size, and spacing consistency.
3. Confirm headings remain readable on dark background.

### C) Friends Search back
1. Friends -> Search friends.
2. Tap back arrow/button.
3. Confirm reliable return to Friends tab.

### D) Logout/login switch (critical)
1. Log in as Account A.
2. Log out from Settings.
3. Log in as Account B using username and password.
4. Confirm no `Cannot read property 'rest' of undefined`.
5. Confirm session and navigation land in app correctly.

### E) Regression checks
1. Discover people still loads users.
2. Stats in Settings still load (or safely degrade).
3. Chat thread opening and unread logic still function.

## 6) Build/Run Immediately After Approval

Run:

```bash
npx expo start --tunnel --clear
```

Then open Expo Go and scan the generated QR code.


