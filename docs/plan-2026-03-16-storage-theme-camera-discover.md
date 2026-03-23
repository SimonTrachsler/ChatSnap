# Fix Plan: Storage, Theme, Camera, Discover

Date: 2026-03-16
Status: Pending approval

## Goal

Fix the reported regressions without changing the existing app architecture:

1. Snap save currently fails with a generic storage error.
2. Friends and Inbox must use the same dark palette as the rest of the app.
3. The unwanted dark frame at the top of the camera preview must be removed.
4. Camera zoom must move from `+/-` buttons to direct touch gesture interaction.
5. Discover People in Friends must stop crashing and must load other users correctly.

## Constraints

- Keep changes minimal and production-safe.
- Preserve existing flows and route structure.
- Reuse existing theme and data helpers where possible.
- Do not change Supabase schema unless an actual schema mismatch is confirmed.
- After approval, leave the project immediately buildable and runnable.

## Problem 1: Snap Save Error

### Observed behavior

- Taking a snap works.
- Pressing `Save` shows: `save failed, storage error, please try again later`.

### Current flow (confirmed from code)

- Screen: `app/(tabs)/photo-preview.tsx`
- Image is optionally recompressed with `expo-image-manipulator`.
- Upload happens first via `src/lib/uploadHelper.ts` into bucket `user-photos`.
- Database insert into `public.user_photos` happens after a successful upload.
- Storage path format already follows the expected policy shape: `<user_id>/<filename>.jpg`.

### Root cause summary

- The upload path ordering is already basically correct, but the real failure cause is hidden.
- `photo-preview.tsx` maps most storage-related failures to a generic user message too early.
- `uploadHelper.ts` throws only `error.message`, so bucket name, code, details, hint, content-type issues, and policy failures are not surfaced clearly.
- The save flow currently has no cleanup plan if upload succeeds but the DB insert fails afterward.
- The bucket/policy setup in the migrations expects uploads only under the current user folder in the private bucket `user-photos`, so any mismatch in runtime upload payload, auth state, or storage response needs to be logged explicitly.

### Planned files to change

- `C:\dev\ChatSnap\app\(tabs)\photo-preview.tsx`
- `C:\dev\ChatSnap\src\lib\uploadHelper.ts`

### Implementation steps

1. Add structured storage debug logging around upload start, success, and failure.
2. Preserve the real Supabase storage error fields (`message`, `code`, `details`, `hint`) instead of flattening them immediately.
3. Keep upload-before-insert ordering, but harden the post-upload insert path.
4. If DB insert fails after upload, add safe cleanup of the just-uploaded storage object where practical.
5. Tighten save-state handling so success only navigates away after both upload and DB insert complete.
6. Keep the user-facing message friendly, but only after logging the real cause.

### Test steps

1. Capture a photo and tap `Save`.
2. Confirm the image is uploaded and a `user_photos` row is created.
3. Re-open Gallery and verify the saved image is visible.
4. Retry save with a fresh photo to confirm the flow is stable more than once.
5. If a failure still occurs, verify the terminal log now exposes the real Supabase storage error details.

## Problem 2: Unified Dark Theme

### Observed behavior

- Gallery and Settings are dark.
- Friends and Inbox still appear lighter/inconsistent.

### Root cause summary

- The project already has a dark palette in `src/ui/theme.ts`, and the root app background is dark.
- The likely inconsistency is not the global theme definition itself, but route-level containers, shared wrappers, refresh/empty/loading states, and page-specific surfaces that are not fully normalized across Friends/Inbox and their subpages.
- This should be solved by auditing and aligning the existing screen backgrounds and shared components, not by redesigning the UI.

### Planned files to change

- `C:\dev\ChatSnap\app\(tabs)\friends\index.tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\discover.tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\requests.tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\chats.tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\detail\[friendId].tsx`
- `C:\dev\ChatSnap\app\(tabs)\friends\chat\[userId].tsx`
- `C:\dev\ChatSnap\app\(tabs)\inbox\index.tsx`
- `C:\dev\ChatSnap\app\(tabs)\inbox\chat\[userId].tsx`
- `C:\dev\ChatSnap\src\ui\components\PageHeader.tsx`
- `C:\dev\ChatSnap\src\ui\components\ScreenHeader.tsx`
- `C:\dev\ChatSnap\app\(tabs)\_layout.tsx` if a navigator-level background fallback still needs to be normalized

### Implementation steps

1. Audit Friends/Inbox route containers for any light or default backgrounds.
2. Normalize shared headers and list containers to the existing dark palette.
3. Ensure empty states, pull-to-refresh indicators, cards, and subpages inherit the same dark surfaces.
4. Keep text contrast readable and avoid any visual redesign beyond palette consistency.

### Test steps

1. Open Friends, Discover, Requests, Chats, Friend Detail, and Friend Chat.
2. Open Inbox and a chat thread.
3. Confirm all screens use the same dark background/surface system as Gallery and Settings.
4. Confirm text, icons, and badges remain readable.

## Problem 3: Dark Frame at Top of Camera

### Observed behavior

- A darker frame/bar is visible at the upper part of the camera screen.

### Root cause summary

- `app/(tabs)/index.tsx` renders an absolute top overlay (`topShade`) over the camera preview.
- That overlay is separate from the actual safe-area positioning of the camera controls, so it is the most direct cause of the unwanted dark frame.

### Planned files to change

- `C:\dev\ChatSnap\app\(tabs)\index.tsx`

### Implementation steps

1. Remove or replace the `topShade` overlay.
2. Re-check the remaining top controls (`Double tap to flip`, camera switch button, error banner) against safe area insets so the preview stays clean.
3. Keep the camera UI readable without reintroducing a tinted frame across the full top region.

### Test steps

1. Open the Camera tab.
2. Confirm the preview reaches the top cleanly without a dark band/frame.
3. Confirm the top controls still remain tappable and readable.

## Problem 4: Camera Zoom by Gesture

### Observed behavior

- Zoom currently uses `+/-` buttons.
- User wants direct gesture-based zoom on the preview.

### Root cause summary

- `app/(tabs)/index.tsx` currently exposes zoom only through button handlers tied to local zoom state.
- There is no touch gesture bound to `CameraView.zoom`.

### Planned files to change

- `C:\dev\ChatSnap\app\(tabs)\index.tsx`

### Implementation steps

1. Remove the existing `+/-` zoom control UI and button handlers.
2. Verify the best low-risk gesture option for the current Expo Camera setup:
   - prefer native pinch gesture support if available in the installed camera/runtime stack
   - otherwise implement a local responder-based pinch/drag solution without adding risky dependencies
3. Clamp zoom safely between min and max bounds.
4. Keep double-tap-to-flip behavior intact and avoid gesture conflicts with capture.

### Test steps

1. Open the Camera tab.
2. Pinch or gesture directly on the preview to zoom in and out.
3. Confirm zoom is smooth, bounded, and stable.
4. Confirm double-tap flip still works.
5. Confirm capture still works after zooming.

## Problem 5: Discover People Error

### Observed behavior

- Tapping `Discover people` does not show users.
- Runtime error shown by user: `Cannot read property 'rest' of undefined`.

### Current flow (confirmed from code)

- Screen: `app/(tabs)/friends/discover.tsx`
- Data sources:
  - `src/lib/discover.ts` -> RPC `get_discover_users`
  - `src/lib/profileSearch.ts` -> RPC `search_profiles`
  - `src/lib/friendRequests.ts` -> relationship-state hydration
- Current code already intends to exclude the current user and keep relationship state handling.

### Root cause summary

- The crash is not obviously caused by a direct `.rest` access in `discover.tsx` itself.
- That points to a data-shape/destructuring issue in a shared helper or in how discover/search results are being mapped at runtime.
- The discover flow also needs stronger defensive handling for `null`/unexpected rows before relationship enrichment and rendering.

### Planned files to change

- `C:\dev\ChatSnap\app\(tabs)\friends\discover.tsx`
- `C:\dev\ChatSnap\src\lib\discover.ts`
- `C:\dev\ChatSnap\src\lib\profileSearch.ts`
- `C:\dev\ChatSnap\src\lib\friendRequests.ts`
- `C:\dev\ChatSnap\src\lib\supabase.ts` if the RPC helper needs stronger typed/null-safe handling

### Implementation steps

1. Reproduce the discover crash in the current runtime and isolate the exact file/line producing the `.rest` failure.
2. Harden the RPC result normalization so `undefined`/`null` rows are filtered before UI/state updates.
3. Ensure discover results exclude the current user both from RPC-backed results and client-side fallback filtering.
4. Preserve relationship state handling (`already_friends`, `pending`, etc.) after the fix.
5. Keep the screen functional even when one subrequest fails by falling back safely instead of crashing.

### Test steps

1. Open Friends -> `Discover people`.
2. Confirm the screen loads other users.
3. Confirm the current user is not listed.
4. Confirm add/request/incoming-request states still render correctly.
5. Use the search field and confirm search results also load without crashing.

## Cross-checks After Implementation

### Static verification

1. Run `npm run lint`
2. Run `npx tsc --noEmit`

### Manual verification

1. Camera:
   - preview has no dark top frame
   - gesture zoom works
   - capture still works
2. Photo preview:
   - `Save` succeeds
   - `Send` path still works
3. Gallery:
   - saved image appears
4. Friends:
   - Discover loads
   - relationship buttons still behave
5. Inbox/Friends:
   - dark theme is consistent across main screens and subpages

## Expected Change Scope

- Minimal app-code changes, focused on the affected screens/helpers only.
- No planned schema migration unless a real storage/schema mismatch is confirmed during implementation.
- No planned route restructuring.

## Ready-to-run Step After Approval

After you approve this plan, the implementation will be followed by these verification commands:

```powershell
npm run lint
npx tsc --noEmit
npx expo start --tunnel
```

If you want the fastest immediate device check after approval, the first command to run is:

```powershell
npx expo start --tunnel
```

