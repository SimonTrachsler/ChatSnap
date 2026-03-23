# crossfunction-light

Expo + React Native + TypeScript App mit Expo Router und Supabase.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- Expo Router 6
- Supabase (Auth, Postgres, Storage)
- Zustand

## Setup

```bash
npm install
```

`.env` erstellen (siehe `.env.example`) und setzen:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

App starten:

```bash
npx expo start
```

## Scripts

- `npm run lint`
- `npx tsc --noEmit`
- `npx expo-doctor`
- `npm run prepare-assets`

## Routing (Expo Router)

### Root

- `app/_layout.tsx` (Auth-Gate + Stack)
- `app/welcome.tsx`
- `app/login.tsx`
- `app/register.tsx`
- `app/auth.tsx` (Legacy-Redirect)
- `app/snap/[id].tsx`
- `app/onboarding/bio.tsx`
- `app/onboarding/avatar.tsx`

### Tabs

- `app/(tabs)/index.tsx` (Camera)
- `app/(tabs)/inbox/index.tsx`
- `app/(tabs)/friends/index.tsx`
- `app/(tabs)/gallery.tsx`
- `app/(tabs)/settings.tsx`
- `app/(tabs)/photo-preview.tsx` (hidden tab route)
- `app/(tabs)/snap-send.tsx` (hidden tab route)

### Nested Routes

- `app/(tabs)/inbox/chat/[userId].tsx`
- `app/(tabs)/friends/chat/[userId].tsx`
- `app/(tabs)/friends/discover.tsx`
- `app/(tabs)/friends/search.tsx`
- `app/(tabs)/friends/requests.tsx`
- `app/(tabs)/friends/detail/[friendId].tsx`

## Main Features

- Auth (Register/Login/Session restore)
- Onboarding (Bio + Avatar)
- Camera capture + preview + send/save
- Friends system (search/discover/requests)
- 1:1 chat (friends-only via backend rule)
- Gallery and Settings
- Account delete via Supabase Edge Function

## Notes

- This project uses a floating tab bar and safe-area aware layouts.
- Chat screen logic is centralized in `src/features/chat/ThreadChatScreen.tsx`.
- If Expo tunnel fails, check ngrok status: <https://status.ngrok.com/>.
