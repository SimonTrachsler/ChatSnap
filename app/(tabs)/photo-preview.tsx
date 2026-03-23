import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import {
  removeUserPhotoUpload,
  StorageUploadError,
  uploadImageFromUri,
  uploadBase64ToUserPhotos,
} from '@/lib/uploadHelper';
import { insertUserPhotoRecord } from '@/lib/userPhotos';
import { usePendingPhotoStore } from '@/store/usePendingPhotoStore';
import { colors, radius, spacing } from '@/ui/theme';
const USE_MANIPULATOR = true;
const MAX_IMAGE_WIDTH = 1080;
const COMPRESS_QUALITY = 0.7;

function toEnglishSaveError(error: unknown): string {
  if (error instanceof StorageUploadError) {
    const lowerStorageMessage = error.message.toLowerCase();
    if (
      lowerStorageMessage.includes('row level security') ||
      lowerStorageMessage.includes('rls') ||
      lowerStorageMessage.includes('policy')
    ) {
      return 'No permission to save. Please log in again.';
    }
    if (
      lowerStorageMessage.includes('unauthorized') ||
      lowerStorageMessage.includes('jwt') ||
      lowerStorageMessage.includes('auth')
    ) {
      return 'Session expired. Please log in again.';
    }
    return 'Photo upload failed. Please try again.';
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
    return 'Network error. Please check your connection and try again.';
  }
  if (lower.includes('unauthorized') || lower.includes('jwt')) {
    return 'Session expired. Please log in again.';
  }
  if (lower.includes('bucket') || lower.includes('storage')) {
    return 'Storage error. Please try again later.';
  }
  if (lower.includes('row level security') || lower.includes('rls') || lower.includes('policy')) {
    return 'No permission to save. Please log in again.';
  }
  return message || 'Save failed. Please try again.';
}

function logSaveFailure(step: string, storagePath: string | null, error: unknown): void {
  if (error instanceof StorageUploadError) {
    console.error('[photo-preview] save failed', {
      step,
      storagePath,
      name: error.name,
      message: error.message,
      bucket: error.bucket,
      path: error.path,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    return;
  }

  console.error('[photo-preview] save failed', {
    step,
    storagePath,
    error,
  });
}

type NavigateAfterSave = 'tabs' | 'gallery';

export default function PhotoPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const paramsUri = useLocalSearchParams<{ uri?: string }>().uri;
  const pendingUri = usePendingPhotoStore((s) => s.pendingPhotoUri);
  const setPendingPhotoUri = usePendingPhotoStore((s) => s.setPendingPhotoUri);
  const uri = pendingUri ?? paramsUri ?? null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const navigatingToSendRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!navigatingToSendRef.current) setPendingPhotoUri(null);
    };
  }, [setPendingPhotoUri]);

  if (!uri) {
    return (
      <View style={styles.container}>
        <Text style={styles.fallbackText}>No image</Text>
        <TouchableOpacity style={styles.pillButton} onPress={() => router.back()}>
          <Text style={styles.pillButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function doSave(navigateAfter: NavigateAfterSave) {
    if (savingRef.current || saving) return;
    const safeUri = uri;
    if (!safeUri) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let storagePath: string | null = null;
    let uploadCompleted = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setError('Not signed in.');
        return;
      }

      const unique = Math.random().toString(36).slice(2, 10);
      storagePath = `${user.id}/${Date.now()}-${unique}.jpg`;

      if (USE_MANIPULATOR) {
        const manipulated = await ImageManipulator.manipulateAsync(
          safeUri,
          [{ resize: { width: MAX_IMAGE_WIDTH } }],
          { compress: COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (!manipulated?.uri) throw new Error('Image processing failed.');
        if (manipulated.base64?.length) {
          await uploadBase64ToUserPhotos(manipulated.base64, storagePath);
        } else if (manipulated.uri) {
          await uploadImageFromUri(manipulated.uri, storagePath);
        }
      } else {
        await uploadImageFromUri(safeUri, storagePath);
      }
      uploadCompleted = true;

      await insertUserPhotoRecord(user.id, storagePath);

      setPendingPhotoUri(null);
      if (navigateAfter === 'gallery') {
        router.replace('/(tabs)/gallery');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e) {
      if (uploadCompleted && storagePath) {
        try {
          await removeUserPhotoUpload(storagePath);
        } catch (cleanupError) {
          console.error('[photo-preview] cleanup after failed save did not complete', {
            storagePath,
            cleanupError,
          });
        }
      }
      logSaveFailure(uploadCompleted ? 'database_insert' : 'storage_upload', storagePath, e);
      const friendly = toEnglishSaveError(e);
      setError(friendly);
      Alert.alert('Save failed', friendly, [{ text: 'OK' }]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleSave() { doSave('tabs'); }
  function handleSend() {
    navigatingToSendRef.current = true;
    router.push('/(tabs)/snap-send');
  }
  function handleDiscard() {
    setPendingPhotoUri(null);
    router.replace('/(tabs)');
  }

  const topInset = insets.top + 12;
  const bottomInset = Math.max(insets.bottom, 12) + 12;

  return (
    <View style={styles.container}>
      <View style={[styles.imageWrap, { top: -insets.top, bottom: insets.top }]}>
        <Image source={{ uri }} style={styles.previewImage} resizeMode="cover" />

        {error ? (
          <View style={[styles.errorBanner, { bottom: bottomInset + 80 }]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.closeButton, { top: topInset }]}
          onPress={handleDiscard}
          disabled={saving}
          activeOpacity={0.86}
        >
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={[styles.bottomBar, { left: 12, right: 12, bottom: bottomInset }]}>
          <TouchableOpacity
            style={[styles.barButton, styles.barButtonSave, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.86}
          >
            {saving ? (
              <ActivityIndicator color={colors.onAccent} size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color={colors.onAccent} style={{ marginRight: 6 }} />
                <Text style={styles.barButtonSaveText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.barButton, styles.barButtonSend, saving && styles.buttonDisabled]}
            onPress={handleSend}
            disabled={saving}
            activeOpacity={0.86}
          >
            <Ionicons name="send" size={18} color={colors.onAccent} style={{ marginRight: 6 }} />
            <Text style={styles.barButtonSendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  fallbackText: { color: colors.textMuted, fontSize: 16, marginBottom: 16 },
  pillButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  pillButtonText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  imageWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  previewImage: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
  },
  closeButton: {
    position: 'absolute',
    left: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(8,15,26,0.72)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  bottomBar: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 10,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(8,15,26,0.8)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  barButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barButtonSave: { backgroundColor: colors.accentSecondary },
  barButtonSend: { backgroundColor: colors.accent },
  barButtonSaveText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  barButtonSendText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  errorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(251,113,133,0.18)',
    borderRadius: radius.sm,
    padding: 12,
  },
  errorText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
