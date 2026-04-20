/**
 * React Native upload helper for user-photos.
 * Uses fetch + FileReader (base64) only – no blob.arrayBuffer() – for Expo SDK 54 compatibility.
 */

import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/telemetry';

const USER_PHOTOS_BUCKET = 'user-photos';
const MAX_UPLOAD_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 300;

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
  const lowerMessage = (error.message ?? '').toLowerCase();
  const isMissingBucket = lowerMessage.includes('bucket not found');

  const payload = {
    bucket,
    path,
    message: error.message ?? null,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    name: error.name ?? null,
  };

  if (isMissingBucket) {
    console.warn(`[uploadHelper] ${action} failed`, payload);
    return;
  }

  console.error(`[uploadHelper] ${action} failed`, payload);
  void reportError('upload_helper_storage_error', error, payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
  const exp = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 120);
  return exp + jitter;
}

function isRetryableStorageError(error: StorageErrorLike): boolean {
  const lowerMsg = (error.message ?? '').toLowerCase();
  const lowerCode = (error.code ?? '').toLowerCase();
  return (
    lowerMsg.includes('network') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('temporarily unavailable') ||
    lowerMsg.includes('connection') ||
    lowerCode === '408' ||
    lowerCode === '429' ||
    lowerCode === '500' ||
    lowerCode === '502' ||
    lowerCode === '503' ||
    lowerCode === '504'
  );
}

function isAlreadyExistsStorageError(error: StorageErrorLike): boolean {
  const lowerMsg = (error.message ?? '').toLowerCase();
  return lowerMsg.includes('already exists') || lowerMsg.includes('duplicate');
}

type UploadPayload = Uint8Array | ArrayBuffer | Blob | File;

type UploadOptions = {
  contentType?: string;
  upsert?: boolean;
};

export async function uploadToBucketWithRetry(
  bucket: string,
  path: string,
  payload: UploadPayload,
  options: UploadOptions,
): Promise<void> {
  let lastError: StorageErrorLike | null = null;

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(bucket).upload(path, payload, options);
    if (!error) return;

    // If a previous attempt likely succeeded but response handling failed,
    // a duplicate-path error on retry is effectively a success for upsert:false flows.
    if (options.upsert === false && isAlreadyExistsStorageError(error)) return;

    lastError = error;
    const canRetry = attempt < MAX_UPLOAD_ATTEMPTS && isRetryableStorageError(error);
    if (!canRetry) break;
    await sleep(getRetryDelayMs(attempt));
  }

  const normalizedError = lastError ?? { message: 'Storage upload failed.' };
  logStorageError('uploadToBucketWithRetry', bucket, path, normalizedError);
  throw new StorageUploadError(bucket, path, normalizedError);
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
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await uploadToBucketWithRetry(USER_PHOTOS_BUCKET, path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
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
  let lastError: StorageErrorLike | null = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(USER_PHOTOS_BUCKET).remove([path]);
    if (!error) return;
    lastError = error;
    if (attempt >= MAX_UPLOAD_ATTEMPTS || !isRetryableStorageError(error)) break;
    await sleep(getRetryDelayMs(attempt));
  }
  const normalizedError = lastError ?? { message: 'Storage cleanup failed.' };
  logStorageError('removeUserPhotoUpload', USER_PHOTOS_BUCKET, path, normalizedError);
  throw new StorageUploadError(USER_PHOTOS_BUCKET, path, normalizedError);
}
