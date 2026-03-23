# Supabase

## Migrationen ausführen

### Option 1: Supabase CLI (empfohlen)

1. [Supabase CLI](https://supabase.com/docs/guides/cli) installieren:
   ```bash
   npm i -g supabase
   ```
2. Im Projekt anmelden und verknüpfen:
   ```bash
   supabase login
   supabase link --project-ref <DEINE_PROJECT_REF>
   ```
   Die Project Ref findest du in der Supabase-Dashboard-URL: `https://app.supabase.com/project/<PROJECT_REF>`.

3. Alle Migrationen aus `supabase/migrations/` anwenden:
   ```bash
   supabase db push
   ```
   Oder eine einzelne Migration manuell ausführen:
   ```bash
   supabase db execute -f supabase/migrations/20250216100002_friend_system.sql
   ```

### Option 2: SQL im Dashboard

1. Im [Supabase Dashboard](https://app.supabase.com) dein Projekt öffnen.
2. Links **SQL Editor** wählen.
3. **New query** klicken, den Inhalt der gewünschten Migration (z. B. `supabase/migrations/20250216100002_friend_system.sql`) einfügen.
4. **Run** ausführen.

**Hinweis:** Bei Option 2 werden Migrationen nicht in der Tabelle `supabase_migrations.schema_migrations` eingetragen. Für saubere Versionskontrolle ist die CLI (Option 1) besser.

## RLS (Row Level Security)

- **profiles**: Nutzer lesen nur das eigene Profil. Suche nach E-Mail nur über die Funktion `profiles_search(search_email)` – liefert nur `id` und `email` (nichts Sensibles).
- **friend_requests**: Erstellen nur als Sender (`from_user = auth.uid()`). Lesen als Sender oder Empfänger. Nur der Empfänger darf die Zeile aktualisieren, und nur das Feld `status` auf `accepted` oder `declined` (Trigger erzwingt das).
- **friends**: Insert nur erlaubt, wenn eine angenommene Anfrage zwischen den beiden Nutzern existiert (`friend_requests.status = 'accepted'`). Die App muss nach dem Annehmen einer Anfrage die Zeile in `friends` anlegen (oder ein Trigger kann das übernehmen).
- **snaps**: Lesen nur Zeilen, in denen der Nutzer Sender oder Empfänger ist. Insert nur als Sender; Trigger `snaps_recipient_must_be_friend` stellt sicher, dass der Empfänger ein angenommener Freund ist (Eintrag in `friends`).
