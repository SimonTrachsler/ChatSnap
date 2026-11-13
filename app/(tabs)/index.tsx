import { useState, useRef, useCallback, useEffect, type ReactElement } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CameraView, useCameraPermissions, type CameraType, type CameraViewProps } from 'expo-camera';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { openSettings } from 'expo-linking';
import { usePendingPhotoStore } from '@/store/usePendingPhotoStore';
import { colors, radius, spacing } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';

const DOUBLE_TAP_DELAY = 300;
const ZOOM_MIN = 0;
const ZOOM_MAX = 1;
const PINCH_ZOOM_SENSITIVITY = 0.0035;
const TAP_MOVE_THRESHOLD = 6;
const CAMERA_START_TIMEOUT = 8000;

// The app's ambient React types do not fully describe Expo's class component.
const CameraPreview = CameraView as unknown as (
  props: Pick<CameraViewProps, 'facing' | 'zoom' | 'onCameraReady' | 'onMountError'> & {
    ref: { current: CameraView | null };
    style: StyleProp<ViewStyle>;
  },
) => ReactElement;

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
  const isFocused = useIsFocused();
  return isFocused ? <ActiveCameraScreen /> : <View style={styles.container} />;
}

function ActiveCameraScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStartError, setCameraStartError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  const captureInProgress = useRef(false);
  const mounted = useRef(false);
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
  const cameraGranted = permission?.granted === true;
  const captureDisabled = !cameraReady || Boolean(cameraStartError) || capturing;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let wasBackgrounded = AppState.currentState === 'background';
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') wasBackgrounded = true;
      if (state === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        void getPermission().catch((error: unknown) => {
          console.warn('[camera] Permission refresh failed:', error);
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  useEffect(() => {
    if (!cameraGranted) {
      setCameraReady(false);
      setCameraStartError(null);
    }
  }, [cameraGranted]);

  useEffect(() => {
    if (!cameraGranted || cameraReady || cameraStartError) return;
    const timer = setTimeout(() => {
      setCameraStartError('Camera preview did not start.');
    }, CAMERA_START_TIMEOUT);
    return () => clearTimeout(timer);
  }, [cameraGranted, cameraReady, cameraStartError]);

  const restartPreview = useCallback(() => {
    if (captureInProgress.current) return;
    setCameraReady(false);
    setCameraStartError(null);
    setError(null);
  }, []);

  const updateZoom = useCallback((value: number) => {
    const next = clampZoom(value);
    zoomRef.current = next;
    setZoom((prev) => (Math.abs(prev - next) >= 0.005 ? next : prev));
  }, []);

  const toggleFacing = useCallback(() => {
    if (captureInProgress.current) return;
    if (cameraStartError) restartPreview();
    updateZoom(0);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, [cameraStartError, restartPreview, updateZoom]);

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
    return (
      <View style={styles.container}>
        <View style={styles.startingPreview}>
          <ActivityIndicator color={colors.textPrimary} accessibilityLabel="Starting camera" />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    const canOpenSettings = Platform.OS !== 'web';
    return (
      <View style={styles.permissionScreen}>
        <View style={styles.permissionBadge}>
          <Text style={styles.permissionBadgeText}>Camera access</Text>
        </View>
        <Text style={styles.permissionText}>
          {permission.canAskAgain
            ? 'Camera access is needed to take photos.'
            : 'Allow camera access in your settings to take photos.'}
        </Text>
        {permission.canAskAgain || canOpenSettings ? (
          <TouchableOpacity
            onPress={() => {
              setError(null);
              const action = permission.canAskAgain ? requestPermission() : openSettings();
              void action.catch(() => setError('Could not open camera permissions.'));
            }}
            style={styles.permissionButton}
          >
            <Text style={styles.permissionButtonText}>
              {permission.canAskAgain ? 'Grant permission' : 'Open settings'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {error ? <Text style={styles.permissionText}>{error}</Text> : null}
      </View>
    );
  }

  async function handleCapture(source: 'preview' | 'system') {
    const camera = cameraRef.current;
    if (captureInProgress.current || (source === 'preview' && (!camera || captureDisabled))) return;
    captureInProgress.current = true;
    setCapturing(true);
    setError(null);
    try {
      let uri: string | undefined;
      if (source === 'system') {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          cameraType: facing === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
          quality: 0.8,
        });
        if (result.canceled) return;
        uri = result.assets[0]?.uri;
      } else {
        const photo = await camera?.takePictureAsync({ quality: 0.8, skipProcessing: false });
        uri = photo?.uri;
      }
      if (!uri) throw new Error('No photo was captured. Try again.');

      try {
        // Re-encode so the preview can display the captured orientation.
        const context = ImageManipulator.manipulate(uri);
        try {
          const image = await context.renderAsync();
          try {
            const normalized = await image.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
            uri = normalized.uri;
          } finally {
            image.release();
          }
        } finally {
          context.release();
        }
      } catch {
        // Keep the captured image if re-encoding fails.
      }

      if (mounted.current && navigation.isFocused() && (source === 'system' || cameraRef.current === camera)) {
        setPendingPhotoUri(uri);
        router.push('/photo-preview');
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      captureInProgress.current = false;
      if (mounted.current) setCapturing(false);
    }
  }

  return (
    <View style={styles.container}>
      {!cameraStartError ? (
        <>
          <CameraPreview
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            zoom={zoom}
            onCameraReady={() => setCameraReady(true)}
            onMountError={({ message }) => {
              console.warn('[camera] Preview start failed:', message);
              setCameraReady(false);
              setCameraStartError(message || 'Camera preview did not start.');
            }}
          />
          <View
            style={StyleSheet.absoluteFill}
            onTouchStart={handleGestureStart}
            onTouchMove={handleGestureMove}
            onTouchEnd={handleGestureEnd}
            onTouchCancel={resetGesture}
          />
          {!cameraReady ? (
            <View style={styles.startingPreview} pointerEvents="none">
              <ActivityIndicator color={colors.textPrimary} accessibilityLabel="Starting camera" />
            </View>
          ) : null}
        </>
      ) : null}

      <View style={[styles.headerChip, { top: insets.top + 12 }]}>
        <Text style={styles.headerChipText}>Pinch to zoom / double tap to flip</Text>
      </View>

      <TouchableOpacity
        style={[styles.switchBtn, { top: insets.top + 8 }]}
        onPress={toggleFacing}
        accessibilityRole="button"
        accessibilityLabel="Switch camera"
        disabled={capturing}
        activeOpacity={0.82}
      >
        <Ionicons name="camera-reverse-outline" size={24} color={colors.textPrimary} />
      </TouchableOpacity>

      {cameraStartError || error ? (
        <View style={[styles.errorBanner, { top: insets.top + 64 }]} accessibilityLiveRegion="polite">
          {cameraStartError ? <Text style={styles.errorText}>{cameraStartError}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {cameraStartError ? (
            <>
              <TouchableOpacity onPress={restartPreview} disabled={capturing}>
                <Text style={styles.retryText}>Restart camera</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' ? (
                <TouchableOpacity onPress={() => handleCapture('system')} disabled={capturing}>
                  <Text style={styles.retryText}>Open device camera</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.controls, { bottom: controlsBottom }]}>
        <TouchableOpacity
          onPress={() => handleCapture('preview')}
          accessibilityLabel="Take photo"
          accessibilityRole="button"
          disabled={captureDisabled}
          style={[styles.captureButton, captureDisabled && styles.captureButtonDisabled]}
        >
          {capturing ? <ActivityIndicator color={colors.onAccent} size="small" /> : <View style={styles.captureButtonInner} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  startingPreview: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
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
    zIndex: 3,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(251,113,133,0.18)',
    borderRadius: radius.sm,
    padding: 12,
  },
  errorText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  retryText: { color: colors.textPrimary, marginTop: 8, fontWeight: '700' },
});
