import { useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import { LoadingScreen } from '@/components/LoadingScreen';
import { usePendingPhotoStore } from '@/store/usePendingPhotoStore';
import { colors, radius, spacing } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';

const DOUBLE_TAP_DELAY = 300;
const ZOOM_MIN = 0;
const ZOOM_MAX = 1;
const PINCH_ZOOM_SENSITIVITY = 0.0035;
const TAP_MOVE_THRESHOLD = 6;

type TouchPoint = {
  pageX: number;
  pageY: number;
};

type CameraTouchEvent = {
  nativeEvent: {
    touches: readonly TouchPoint[];
  };
};

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function getTouchDistance(touches: readonly TouchPoint[]): number {
  if (touches.length < 2) return 0;
  const [first, second] = touches;
  const dx = second.pageX - first.pageX;
  const dy = second.pageY - first.pageY;
  return Math.hypot(dx, dy);
}

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [zoom, setZoom] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<{ takePictureAsync: (opts?: object) => Promise<{ uri: string }> } | null>(null);
  const setPendingPhotoUri = usePendingPhotoStore((s) => s.setPendingPhotoUri);
  const lastTapRef = useRef(0);
  const zoomRef = useRef(0);
  const gestureRef = useRef({
    active: false,
    hadPinch: false,
    startDistance: 0,
    startZoom: 0,
    tapStartX: 0,
    tapStartY: 0,
    tapMoved: false,
  });
  const tabBarMetrics = getFloatingTabBarMetrics(insets);
  const controlsBottom = tabBarMetrics.height + tabBarMetrics.bottom + spacing.md;

  const updateZoom = useCallback((value: number) => {
    const next = clampZoom(value);
    zoomRef.current = next;
    setZoom((prev) => (Math.abs(prev - next) >= 0.005 ? next : prev));
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, []);

  const handlePreviewTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      lastTapRef.current = 0;
      toggleFacing();
    } else {
      lastTapRef.current = now;
    }
  }, [toggleFacing]);

  const resetGesture = useCallback(() => {
    gestureRef.current = {
      active: false,
      hadPinch: false,
      startDistance: 0,
      startZoom: zoomRef.current,
      tapStartX: 0,
      tapStartY: 0,
      tapMoved: false,
    };
  }, []);

  const handleGestureStart = useCallback((event: CameraTouchEvent) => {
    const touches = event.nativeEvent.touches;
    if (touches.length >= 2) {
      const distance = getTouchDistance(touches);
      if (distance > 0) {
        gestureRef.current = {
          active: true,
          hadPinch: true,
          startDistance: distance,
          startZoom: zoomRef.current,
          tapStartX: 0,
          tapStartY: 0,
          tapMoved: true,
        };
      }
      return;
    }

    const touch = touches[0];
    if (!touch) return;

    gestureRef.current.tapStartX = touch.pageX;
    gestureRef.current.tapStartY = touch.pageY;
    gestureRef.current.tapMoved = false;
  }, []);

  const handleGestureMove = useCallback((event: CameraTouchEvent) => {
    const touches = event.nativeEvent.touches;
    const distance = getTouchDistance(touches);
    if (distance > 0) {
      if (!gestureRef.current.active) {
        gestureRef.current.active = true;
        gestureRef.current.hadPinch = true;
        gestureRef.current.startDistance = distance;
        gestureRef.current.startZoom = zoomRef.current;
      }
      const delta = distance - gestureRef.current.startDistance;
      updateZoom(gestureRef.current.startZoom + delta * PINCH_ZOOM_SENSITIVITY);
      return;
    }

    const touch = touches[0];
    if (!touch) return;

    if (
      Math.abs(touch.pageX - gestureRef.current.tapStartX) >= TAP_MOVE_THRESHOLD ||
      Math.abs(touch.pageY - gestureRef.current.tapStartY) >= TAP_MOVE_THRESHOLD
    ) {
      gestureRef.current.tapMoved = true;
    }
  }, [updateZoom]);

  const handleGestureEnd = useCallback((event: CameraTouchEvent) => {
    if (event.nativeEvent.touches.length > 0) {
      gestureRef.current.active = false;
      return;
    }

    const shouldHandleTap = !gestureRef.current.hadPinch && !gestureRef.current.tapMoved;
    resetGesture();
    if (shouldHandleTap) {
      handlePreviewTap();
    }
  }, [handlePreviewTap, resetGesture]);

  if (!permission) {
    return <LoadingScreen message="Loading camera..." />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <View style={styles.permissionBadge}>
          <Text style={styles.permissionBadgeText}>Camera access</Text>
        </View>
        <Text style={styles.permissionText}>Camera access is needed to take photos.</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (photo?.uri) {
        let normalizedUri = photo.uri;
        try {
          // Re-encode once so EXIF/orientation metadata doesn't cause odd rotations in preview.
          const normalized = await ImageManipulator.manipulateAsync(
            photo.uri,
            [],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
          );
          if (normalized?.uri) normalizedUri = normalized.uri;
        } catch {
          // Fallback to original URI if normalization fails.
        }
        setPendingPhotoUri(normalizedUri);
        router.push('/(tabs)/photo-preview');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setCapturing(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.cameraWrap, { top: -insets.top, bottom: insets.top }]}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          zoom={zoom}
          mode="picture"
        />
        <View
          style={styles.gestureLayer}
          onTouchStart={handleGestureStart}
          onTouchMove={handleGestureMove}
          onTouchEnd={handleGestureEnd}
          onTouchCancel={() => resetGesture()}
        />
      </View>

      <View style={[styles.headerChip, { top: insets.top + 12 }]}>
        <Text style={styles.headerChipText}>Pinch to zoom / double tap to flip</Text>
      </View>

      <TouchableOpacity style={[styles.switchBtn, { top: insets.top + 8 }]} onPress={toggleFacing} activeOpacity={0.82}>
        <Ionicons name="camera-reverse-outline" size={24} color={colors.textPrimary} />
      </TouchableOpacity>

      {error ? (
        <View style={[styles.errorBanner, { top: insets.top + 64 }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.controls, { bottom: controlsBottom }]}>
        <TouchableOpacity
          onPress={handleCapture}
          disabled={capturing}
          style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
        >
          {capturing ? <ActivityIndicator color={colors.onAccent} size="small" /> : <View style={styles.captureButtonInner} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cameraWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  camera: { flex: 1 },
  gestureLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  headerChip: {
    position: 'absolute',
    left: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,15,26,0.72)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    zIndex: 2,
  },
  headerChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  switchBtn: {
    position: 'absolute',
    right: 18,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(8,15,26,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    zIndex: 2,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 4,
  },
  captureButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonDisabled: { opacity: 0.5 },
  captureButtonInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.accent,
  },
  permissionScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  permissionBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    marginBottom: spacing.lg,
  },
  permissionBadgeText: {
    color: colors.accentSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  permissionText: { color: colors.textSecondary, textAlign: 'center', marginBottom: 24, fontSize: 15, lineHeight: 22 },
  permissionButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  permissionButtonText: { color: colors.onAccent, fontWeight: '700' },
  errorBanner: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(251,113,133,0.18)',
    borderRadius: radius.sm,
    padding: 12,
  },
  errorText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
