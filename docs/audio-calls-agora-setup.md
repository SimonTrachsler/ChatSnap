# ChatSnap Audio Calls (Agora) Setup

## 1) Supabase migration

Run your pending migrations so `call_sessions` exists:

```bash
supabase db push
```

## 2) Supabase Edge Function secrets

Set these secrets on your Supabase project:

```bash
supabase secrets set AGORA_APP_ID=YOUR_AGORA_APP_ID
supabase secrets set AGORA_APP_CERTIFICATE=YOUR_AGORA_APP_CERTIFICATE
supabase secrets set AGORA_TOKEN_TTL_SECONDS=3600
```

Or use the helper script:

```bash
npm run supabase:set-agora-secrets -- --app-id=YOUR_AGORA_APP_ID --app-cert=YOUR_AGORA_APP_CERTIFICATE --ttl=3600
```

`AGORA_APP_ID` is required.
`AGORA_APP_CERTIFICATE` can be omitted for debug mode, but production should always use it.

## 3) Deploy Edge Function

```bash
supabase functions deploy create-call-token --no-verify-jwt
```

`create-call-token` verifies the user JWT inside the function, so gateway JWT verification should stay disabled for this function.

## 4) Rebuild native app

Because `react-native-agora` is a native module, rebuild the app after install/config changes:

```bash
npx expo run:ios
npx expo run:android
```

## 5) Basic call flow

1. Open a 1:1 chat and tap the call icon.
2. Callee is auto-routed to the incoming call screen and receives ring feedback (vibration + ringtone).
3. Callee taps `Accept`, both users join Agora audio.
4. While ringing: caller can `Cancel`, callee can `Accept` or `Decline`.
5. In active call: both users can use `Mute`, `Speaker`, and `End`, and see a live call duration timer.

## 6) Readiness check behavior

The app probes call readiness before enabling the call button:

- Missing `AGORA_APP_ID`: calls are disabled.
- `AGORA_APP_ID` present, missing `AGORA_APP_CERTIFICATE`: calls are enabled in debug mode (no secure token).
- Both present: calls are fully enabled with secure token generation.

Call session constraints:

- A user can only be part of one active call (`ringing` or `accepted`) at a time.
- Chat pre-check uses `get_call_availability(...)` so the call button can be disabled with a clear reason (for example: friend busy in another call).
- `call_presence` is synced by DB triggers and published via realtime for instant availability updates in chat.

## 7) End-to-end token flow check (local)

Use this after deployment to verify that the full flow works (`auth -> thread -> call_session -> edge function token`):

```bash
npm run verify:call-token-flow
```

Required local env vars for this script:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional `AGORA_APP_ID` (if set, script asserts response appId matches it)

## 8) Call status guard check (local)

Use this to verify status transition guards (caller cannot self-accept; callee can accept):

```bash
npm run verify:call-status-guards
```

Required local env vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 9) Single-active-call-per-user guard check (local)

Use this to verify that users cannot start a second active call while already in one:

```bash
npm run verify:call-single-active-user-guard
```

Required local env vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 10) Call availability RPC check (local)

Use this to verify the friend-safe availability RPC (`available`, `already_with_you`, `target_busy`):

```bash
npm run verify:call-availability
```

Required local env vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 11) Call presence sync check (local)

Use this to verify `call_presence` trigger sync (false -> true on ringing -> false on cancel):

```bash
npm run verify:call-presence-sync
```

Required local env vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Run all local call checks together:

```bash
npm run verify:calls
```
