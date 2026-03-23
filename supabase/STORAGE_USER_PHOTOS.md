# Storage Bucket: user-photos

Private Bucket für Nutzer-Galerie. Kein öffentlicher Lesezugriff; Zugriff nur über RLS auf eigene Dateien.

## Anforderungen

- **Authenticated users can upload** – nur eingeloggte User dürfen hochladen.
- **Users can only access their own files** – Lese-/Löschzugriff nur auf Dateien im eigenen Ordner.
- **Public read not allowed** – Bucket ist privat (`public: false`).

## Pfadkonvention

- Ein Ordner pro User: `<user_id>/<filename>`
- Beispiel: `a1b2c3d4-.../photo-1708123456789.jpg`

Damit lässt sich in den Storage-Policies prüfen: erstes Pfadsegment = `auth.uid()::text`.

## SQL: Bucket + Policies

```sql
-- =============================================================================
-- Storage Bucket "user-photos" (private)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-photos',
  'user-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
);

-- Upload: nur in den eigenen Ordner (erstes Pfadsegment = auth.uid())
create policy "user_photos_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lesen: nur eigene Dateien (kein öffentlicher Lesezugriff)
create policy "user_photos_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Löschen: nur eigene Dateien
create policy "user_photos_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

## Konfiguration der Bucket-Policies

### 1. Bucket anlegen

- **`public: false`** – Kein direkter Zugriff über Public-URL; alle Zugriffe laufen über die Storage-API und RLS.
- **`file_size_limit`** (z. B. 5242880 = 5 MB) und **`allowed_mime_types`** begrenzen Größe und Typ.

### 2. Policies auf `storage.objects`

Supabase Storage nutzt **Row Level Security (RLS)** auf der Tabelle `storage.objects`. Jede Operation (INSERT, SELECT, UPDATE, DELETE) braucht eine passende Policy.

| Operation | Policy-Name              | Logik |
|----------|--------------------------|--------|
| **INSERT** | `user_photos_storage_insert_own` | `with check`: Bucket = `user-photos` und erstes Pfadsegment = `auth.uid()::text`. User kann nur unter `{eigene_uid}/...` hochladen. |
| **SELECT** | `user_photos_storage_select_own` | `using`: Gleiche Bedingung. Nur eigene Dateien lesbar (z. B. für `createSignedUrl` oder Download). |
| **DELETE** | `user_photos_storage_delete_own`  | `using`: Gleiche Bedingung. Nur eigene Dateien löschbar. |

- **`storage.foldername(name)`** – Liefert ein Array von Ordnernamen im Pfad; `[1]` = erstes Segment = User-ID.
- **`auth.uid()`** – Aktuell eingeloggter User (JWT). Ohne Login gibt es keine Berechtigung.

### 3. Keine Policy = kein Zugriff

- Wenn für eine Operation **keine** Policy erlaubt, wird der Zugriff verweigert.
- Es gibt **keine** Policy für `anon` oder öffentlichen Lesezugriff → kein Public Read.

### 4. Anwendung im Projekt

- Migration: `supabase/migrations/20250216100008_user_photos_bucket.sql`
- Anwenden: `supabase db push` oder Migration im Dashboard ausführen.

## Private Bucket: Anzeige in der App

Da der Bucket **privat** ist, gibt es keine dauerhaft gültige Public-URL. In `user_photos.image_url` wird der **Storage-Pfad** (z. B. `{user_id}/photo-123.jpg`) gespeichert. Beim Anzeigen in der Galerie:

- **Signed URL** erzeugen: `supabase.storage.from('user-photos').createSignedUrl(path, expirySeconds)`
- Die zurückgegebene URL temporär (z. B. 1 Stunde) für Thumbnail/Fullscreen nutzen.
