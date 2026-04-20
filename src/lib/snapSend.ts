/**
 * Shared snap-sending and user-gallery logic.
 * - createSnapWithImage: create snap row, upload image to snaps bucket, set media_url.
 * Uses the same image bytes where possible to avoid duplicate uploads.
 */

import type { Database } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { uploadToBucketWithRetry } from '@/lib/uploadHelper';
import { reportError, trackEvent } from '@/lib/telemetry';

const SNAPS_BUCKET = 'snaps';

type ImagePayload = Uint8Array | Blob;

type SnapsInsert = Database['public']['Tables']['snaps']['Insert'];
type SnapsUpdate = Database['public']['Tables']['snaps']['Update'];

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

  try {
    await uploadToBucketWithRetry(SNAPS_BUCKET, storagePath, imageBytes, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  } catch (uploadError) {
    await supabase.from('snaps').delete().eq('id', snapId);
    void reportError('create_snap_with_image_upload_failed', uploadError, {
      snapId,
      storagePath,
    });
    throw new Error('Upload fehlgeschlagen: ' + (uploadError instanceof Error ? uploadError.message : String(uploadError)));
  }

  const update: SnapsUpdate = { media_url: storagePath };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table typed in database.ts
  const { error: updateError } = await (supabase as any).from('snaps').update(update).eq('id', snapId);

  if (updateError) {
    await Promise.allSettled([
      supabase.storage.from(SNAPS_BUCKET).remove([storagePath]),
      supabase.from('snaps').delete().eq('id', snapId),
    ]);
    void reportError('create_snap_with_image_update_failed', updateError, {
      snapId,
      storagePath,
    });
    throw new Error('Could not save media URL: ' + updateError.message);
  }

  void trackEvent('snap_created', {
    snapId,
    recipientId,
  });
  return snapId;
}
