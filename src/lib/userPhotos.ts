import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type UserPhotoInsert = Database['public']['Tables']['user_photos']['Insert'];
type UserPhotoPathColumn = 'storage_path' | 'image_url';

let preferredPathColumn: UserPhotoPathColumn | null = null;

type UserPhotoPathSource = {
  storage_path?: string | null;
  image_url?: string | null;
};

function isMissingStoragePathColumnError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? '').toLowerCase();
  return (
    message.includes('storage_path')
    && (message.includes('schema cache') || message.includes('could not find') || message.includes('does not exist'))
  );
}

function normalizeStoragePath(path: string): string {
  return decodeURIComponent(path).split('?')[0] ?? '';
}

function storagePathFromImageUrl(imageUrl: string): string {
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    return normalizeStoragePath(imageUrl);
  }
  const match = imageUrl.match(/\/user-photos\/(.+?)(?:\?|$)/);
  return match ? normalizeStoragePath(match[1]) : '';
}

export function getUserPhotoStoragePath(photo: UserPhotoPathSource): string {
  if (photo.storage_path) return normalizeStoragePath(photo.storage_path);
  const legacy = photo.image_url ?? '';
  if (!legacy) return '';
  return storagePathFromImageUrl(legacy);
}

export function getUserPhotoDisplayUri(photo: UserPhotoPathSource): string | null {
  const uri = photo.image_url;
  return typeof uri === 'string' && uri.startsWith('https://') ? uri : null;
}

async function insertWithStoragePath(userId: string, storagePath: string): Promise<{ message?: string } | null> {
  const payload: UserPhotoInsert = {
    user_id: userId,
    storage_path: storagePath,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime schema may vary between environments
  const { error } = await (supabase.from('user_photos') as any).insert(payload);
  return error as { message?: string } | null;
}

async function insertWithLegacyImageUrl(userId: string, storagePath: string): Promise<{ message?: string } | null> {
  const payload: UserPhotoInsert = {
    user_id: userId,
    image_url: storagePath,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime schema may vary between environments
  const { error } = await (supabase.from('user_photos') as any).insert(payload);
  return error as { message?: string } | null;
}

export async function insertUserPhotoRecord(userId: string, storagePath: string): Promise<void> {
  if (preferredPathColumn === 'image_url') {
    const legacyError = await insertWithLegacyImageUrl(userId, storagePath);
    if (legacyError) throw new Error(`Could not save photo record: ${legacyError.message}`);
    return;
  }

  const storagePathError = await insertWithStoragePath(userId, storagePath);
  if (!storagePathError) {
    preferredPathColumn = 'storage_path';
    return;
  }

  if (!isMissingStoragePathColumnError(storagePathError)) {
    throw new Error(`Could not save photo record: ${storagePathError.message}`);
  }

  const legacyError = await insertWithLegacyImageUrl(userId, storagePath);
  if (legacyError) {
    throw new Error(`Could not save photo record: ${legacyError.message}`);
  }
  preferredPathColumn = 'image_url';
}

