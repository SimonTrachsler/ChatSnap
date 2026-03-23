/**
 * React Native upload helper for user-photos.
 * Uses fetch + FileReader (base64) only – no blob.arrayBuffer() – for Expo SDK 54 compatibility.
 */

import { supabase } from '@/lib/supabase';

const USER_PHOTOS_BUCKET = 'user-photos';

type StorageErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  name?: string;
};

export class StorageUploadError extends Error {
  bucket: string;
  path: string;
  code?: string;
  details?: string;
  hint?: string;

  constructor(bucket: string, path: string, error: StorageErrorLike) {
    super(error.message ?? 'Storage upload failed.');
    this.name = 'StorageUploadError';
    this.bucket = bucket;
    this.path = path;
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function logStorageError(action: string, bucket: string, path: string, error: StorageErrorLike): void {
  console.error(`[uploadHelper] ${action} failed`, {
    bucket,
    path,
    message: error.message ?? null,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    name: error.name ?? null,
  });
}

/**
 * Converts a local file URI to base64 via fetch and FileReader.
 * Does not use blob.arrayBuffer(). Works with file:// and content:// on React Native / Expo SDK 54.
 * Returns the raw base64 string (no data:image/...;base64, prefix).
 */
export async function uriToBase64(uri: string): Promise<string> {
  const res = await fetch(uri, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Failed to read image: ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Image file is empty. Please try again or save.');
  }
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File could not be read.'));
    reader.onloadend = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
  if (!base64.length) {
    throw new Error('Image file is empty. Please try again or save.');
  }
  return base64;
}

/**
 * Converts a Blob to base64 using FileReader (no blob.arrayBuffer()).
 * Returns the raw base64 string (no data:image/...;base64, prefix).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Blob could not be read.'));
    reader.onloadend = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
  if (!base64.length) {
    throw new Error('Image data is empty.');
  }
  return base64;
}

/**
 * Uploads a base64-encoded image to user-photos.
 * Use when you have base64 from ImageManipulator.manipulateAsync(..., { base64: true })
 * or from uriToBase64(uri).
 */
export async function uploadBase64ToUserPhotos(base64: string, path: string): Promise<void> {
  const trimmed = base64.replace(/^data:image\/\w+;base64,/, '').trim();
  if (!trimmed.length) throw new Error('Image file is empty.');
  if (__DEV__) {
    console.log('[uploadHelper] uploading to user-photos', {
      path,
      base64Length: trimmed.length,
    });
  }
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const { error } = await supabase.storage
    .from(USER_PHOTOS_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    logStorageError('uploadBase64ToUserPhotos', USER_PHOTOS_BUCKET, path, error);
    throw new StorageUploadError(USER_PHOTOS_BUCKET, path, error);
  }
}

/**
 * Converts a local file URI to base64 and uploads to user-photos.
 * Single entry point for "camera URI → Storage" flow (no blob.arrayBuffer).
 */
export async function uploadImageFromUri(uri: string, path: string): Promise<void> {
  const base64 = await uriToBase64(uri);
  await uploadBase64ToUserPhotos(base64, path);
}

export async function removeUserPhotoUpload(path: string): Promise<void> {
  const { error } = await supabase.storage.from(USER_PHOTOS_BUCKET).remove([path]);
  if (error) {
    logStorageError('removeUserPhotoUpload', USER_PHOTOS_BUCKET, path, error);
    throw new StorageUploadError(USER_PHOTOS_BUCKET, path, error);
  }
}
