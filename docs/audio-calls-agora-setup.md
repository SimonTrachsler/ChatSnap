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

`AGORA_APP_CERTIFICATE` can be omitted for debug mode, but production should always use it.

## 3) Deploy Edge Function

```bash
supabase functions deploy create-call-token
```

## 4) Rebuild native app

Because `react-native-agora` is a native module, rebuild the app after install/config changes:

```bash
npx expo run:ios
npx expo run:android
```

## 5) Basic call flow

1. Open a 1:1 chat and tap the call icon.
2. Callee is auto-routed to the incoming call screen.
3. Callee taps `Accept`, both users join Agora audio.
4. Use `Mute`, `Speaker`, and `End` controls in the call screen.

