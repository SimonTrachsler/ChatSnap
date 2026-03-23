/**
 * Shared snap-sending and user-gallery logic.
 * - saveToUserGallery: upload to user-photos bucket + insert user_photos row (best-effort).
 * - createSnapWithImage: create snap row, upload image to snaps bucket, set media_url.
 * Uses the same image bytes where possible to avoid duplicate uploads.
 */

import type { Database } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { insertUserPhotoRecord } from '@/lib/userPhotos';

const USER_PHOTOS_BUCKET = 'user-photos';
const SNAPS_BUCKET = 'snaps';

type ImagePayload = Uint8Array | Blob;

type SnapsInsert = Database['public']['Tables']['snaps']['Insert'];
type SnapsUpdate = Database['public']['Tables']['snaps']['Update'];

/** Upload image to user-photos and insert user_photos row. Returns storage path or null. Does not throw. */
export async function saveToUserGallery(
  userId: string,
  imageBytes: ImagePayload
): Promise<string | null> {
  const path = `${userId}/photo-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(USER_PHOTOS_BUCKET)
    .upload(path, imageBytes, { contentType: 'image/jpeg', upsert: false });

  if (uploadError) return null;

  try {
    await insertUserPhotoRecord(userId, path);
  } catch {
    return null;
  }

  return path;
}

/**
 * Create a snap for the recipient and upload the image to the snaps bucket.
 * Uses the provided image bytes (no re-download). Throws on failure.
 */
export async function createSnapWithImage(
  senderId: string,
  recipientId: string,
  imageBytes: ImagePayload
): Promise<string> {
  const insert: SnapsInsert = {
    sender_id: senderId,
    recipient_id: recipientId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table typed in database.ts
  const { data: snap, error: insertError } = await (supabase as any).from('snaps').insert(insert).select('id').single();

  if (insertError) throw new Error('Could not create snap: ' + insertError.message);
  const snapId = (snap as { id: string } | null)?.id;
  if (!snapId) throw new Error('Snap-ID fehlt.');

  const filename = 'photo-' + Date.now() + '.jpg';
  const storagePath = `${snapId}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(SNAPS_BUCKET)
    .upload(storagePath, imageBytes, { contentType: 'image/jpeg', upsert: false });

  if (uploadError) {
    await supabase.from('snaps').delete().eq('id', snapId);
    throw new Error('Upload fehlgeschlagen: ' + uploadError.message);
  }

  const update: SnapsUpdate = { media_url: storagePath };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table typed in database.ts
  const { error: updateError } = await (supabase as any).from('snaps').update(update).eq('id', snapId);

  if (updateError) {
    throw new Error('Could not save media URL: ' + updateError.message);
  }

  return snapId;
}
