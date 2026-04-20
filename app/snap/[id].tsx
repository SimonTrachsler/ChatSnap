import { useEffect, useState, useRef } from 'react';
import { View, Text, Image, Pressable, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { addScreenshotListener } from 'expo-screen-capture';
import { supabase, getUpdateClient } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Avatar } from '@/ui/components/Avatar';
import { colors, radius } from '@/ui/theme';
import { logSnapScreenshotEvent } from '@/lib/socialFeatures';

type Snap = {
  id: string;
  opened: boolean;
  media_url: string | null;
  is_sensitive: boolean;
  recipient_id: string;
  sender_id: string;
};
const snapsUpdateClient = getUpdateClient<Pick<Snap, 'opened'>>('snaps');

export default function SnapDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.user?.id);

  const [snap, setSnap] = useState<Snap | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [senderName, setSenderName] = useState<string | null>(null);
  const [senderAvatar, setSenderAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasMarkedOpened = useRef(false);

  useEffect(() => {
    if (!id || !userId) {
      setLoading(false);
      if (!id) setError('Snap not found.');
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error: fetchError } = await supabase
        .from('snaps')
        .select('id, opened, media_url, is_sensitive, recipient_id, sender_id')
        .eq('id', id)
        .eq('recipient_id', userId)
        .single();

      if (cancelled) return;
      setLoading(false);

      if (fetchError || !data) {
        setError(fetchError?.message ?? 'Snap not found.');
        return;
      }

      const s = data as Snap;
      setSnap(s);

      // Fetch sender profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', s.sender_id)
        .maybeSingle();
      if (!cancelled && profile) {
        const p = profile as { username?: string | null; avatar_url?: string | null };
        setSenderName(p.username ?? null);
        setSenderAvatar(p.avatar_url ?? null);
      }

      if (s.opened) return;

      if (s.media_url) {
        const { data: signed } = await supabase.storage
          .from('snaps')
          .createSignedUrl(s.media_url!, 60);
        if (!cancelled && signed?.signedUrl) {
          setImageUri(signed.signedUrl);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [id, userId]);

  useEffect(() => {
    if (!snap?.id || !snap.is_sensitive) return;
    const listener = addScreenshotListener(() => {
      logSnapScreenshotEvent(snap.id, Platform.OS).catch(() => {});
    });
    return () => {
      listener.remove();
    };
  }, [snap?.id, snap?.is_sensitive]);

  async function handleTapToClose() {
    if (!snap || snap.opened || hasMarkedOpened.current) return;
    hasMarkedOpened.current = true;
    await snapsUpdateClient.update({ opened: true }).eq('id', snap.id);
    router.back();
  }

  const goToInbox = () => router.replace('/(tabs)/inbox');

  if (loading) return <LoadingScreen message="Loading snap…" />;

  if (error || !snap) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Snap not found.'}</Text>
        <TouchableOpacity onPress={goToInbox} style={styles.button}>
          <Text style={styles.buttonText}>To Inbox</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (snap.opened) {
    return (
      <View style={styles.centered}>
        <Text style={styles.expiredTitle}>Snap expired</Text>
        <Text style={styles.expiredSubtitle}>This snap was already opened.</Text>
        <TouchableOpacity onPress={goToInbox} style={styles.button}>
          <Text style={styles.buttonText}>To Inbox</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Pressable style={styles.fullscreen} onPress={handleTapToClose}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={styles.imagePlaceholder}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.placeholderText}>Loading image…</Text>
        </View>
      )}
      {/* Sender overlay */}
      <View style={styles.senderOverlay}>
        <Avatar uri={senderAvatar} fallback={senderName ?? '?'} size="sm" />
        <Text style={styles.senderName}>{senderName ?? 'Unknown'}</Text>
      </View>
      <View style={styles.hintOverlay}>
        <Text style={styles.hintText}>{snap.is_sensitive ? 'Sensitive snap - screenshot detection active' : 'Tap to close'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  placeholderText: { marginTop: 12, fontSize: 14, color: colors.textMuted },
  senderOverlay: {
    position: 'absolute',
    top: 52,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  senderName: { fontSize: 14, fontWeight: '600', color: '#fff' },
  hintOverlay: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  errorText: { fontSize: 14, color: colors.error, textAlign: 'center', marginBottom: 20 },
  expiredTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  expiredSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 24 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  buttonText: { fontSize: 16, fontWeight: '600', color: colors.bg },
});
