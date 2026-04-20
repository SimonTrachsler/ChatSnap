# Staging And Release Checklist

## Staging Environment

1. Create a dedicated Supabase staging project.
2. Set staging env vars:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_TELEMETRY_ENABLED=true`
3. Run migrations on staging first:
   - `supabase db push`
4. Smoke test critical flows:
   - Auth (login/register)
   - Camera save
   - Snap send/open
   - Inbox unread reset

## Release Gate

1. CI must pass:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run doctor`
2. Validate no pending dangerous migrations.
3. Validate telemetry inserts are working in staging.
4. Create release build only after staging sign-off.
