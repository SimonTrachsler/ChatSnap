import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type UserPhotoInsert = Database['public']['Tables']['user_photos']['Insert'];

type UserPhotoPathSource = {
  storage_path?: string | null;
};

function normalizeStoragePath(path: string): string {
  return decodeURIComponent(path).split('?')[0] ?? '';
}

export function getUserPhotoStoragePath(photo: UserPhotoPathSource): string {
  if (!photo.storage_path) return '';
  return normalizeStoragePath(photo.storage_path);
}

export async function insertUserPhotoRecord(userId: string, storagePath: string): Promise<void> {
  const normalizedStoragePath = normalizeStoragePath(storagePath);
  if (!normalizedStoragePath) {
    throw new Error('Could not save photo record: storage path missing.');
  }

  const payload: UserPhotoInsert = {
    user_id: userId,
    storage_path: normalizedStoragePath,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for inserts is narrower than runtime schema
  const { error } = await (supabase.from('user_photos') as any).insert(payload);
  if (error) {
    throw new Error(`Could not save photo record: ${error.message}`);
  }
}
