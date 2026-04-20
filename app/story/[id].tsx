import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getStorySignedUrl,
  listStoriesByUser,
  markStoryViewed,
  resolveStoryOwnerId,
  type StoryItem,
} from '@/lib/socialFeatures';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/ui/theme';

const STORY_DURATION_MS = 5000;

export default function StoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [signedUrlByStoryId, setSignedUrlByStoryId] = useState<Record<string, string>>({});
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Story not found.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const me = authData.user?.id ?? null;
        if (cancelled) return;
        setMyUserId(me);

        const resolvedOwner = (await resolveStoryOwnerId(id)) ?? id;
        if (cancelled) return;
        setOwnerId(resolvedOwner);

        const items = await listStoriesByUser(resolvedOwner);
        if (!items.length) {
          throw new Error('No active stories found.');
        }
        if (cancelled) return;
        setStories(items);
        setCurrentIndex(0);

        const signedPairs = await Promise.all(
          items.map(async (story) => {
            const signed = await getStorySignedUrl(story.media_path, 900);
            return signed ? ([story.id, signed] as const) : null;
          }),
        );
        if (!cancelled) {
          setSignedUrlByStoryId(
            Object.fromEntries(signedPairs.filter((pair): pair is readonly [string, string] => !!pair)),
          );
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load story.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!stories.length || !myUserId || !ownerId || ownerId === myUserId) return;
    Promise.all(stories.map((story) => markStoryViewed(story.id).catch(() => undefined))).catch(() => undefined);
  }, [myUserId, ownerId, stories]);

  useEffect(() => {
    if (!stories.length) return;
    setCurrentProgress(0);

    const story = stories[currentIndex];
    if (!story) return;

    const start = Date.now();
    const progressTimer = setInterval(() => {
      const value = Math.min(1, (Date.now() - start) / STORY_DURATION_MS);
      setCurrentProgress(value);
    }, 80);

    const autoNextTimer = setTimeout(() => {
      setCurrentIndex((prev) => (prev < stories.length - 1 ? prev + 1 : prev));
    }, STORY_DURATION_MS);

    return () => {
      clearInterval(progressTimer);
      clearTimeout(autoNextTimer);
    };
  }, [currentIndex, stories]);

  const currentStory = stories[currentIndex] ?? null;
  const currentMediaUrl = currentStory ? signedUrlByStoryId[currentStory.id] ?? null : null;
  const isLastStory = stories.length > 0 && currentIndex >= stories.length - 1;

  useEffect(() => {
    setImageFailed(false);
  }, [currentStory?.id, currentMediaUrl]);

  const progressValues = stories.map((_, index) => {
    if (index < currentIndex) return 1;
    if (index > currentIndex) return 0;
    return currentProgress;
  });

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < stories.length - 1 ? prev + 1 : 0));
  }, [stories.length]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error || !currentStory) {
    return (
      <Pressable style={styles.center} onPress={() => router.back()}>
        <Text style={styles.error}>{error ?? 'Story missing.'}</Text>
        <Text style={styles.hint}>Tap to close</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.progressRow}>
        {progressValues.map((value: number, index: number) => (
          <View key={`${stories[index]?.id ?? index}`} style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, value * 100))}%` }]} />
          </View>
        ))}
      </View>

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.indexText}>
          {currentIndex + 1}/{stories.length}
        </Text>
      </View>

      {currentStory.media_kind === 'video' ? (
        <View style={styles.videoFallback}>
          <Ionicons name="videocam-outline" size={30} color={colors.textPrimary} />
          <Text style={styles.videoFallbackText}>Video story</Text>
        </View>
      ) : currentMediaUrl && !imageFailed ? (
        <Image
          source={{ uri: currentMediaUrl }}
          style={styles.image}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.mediaFallback}>
          <Ionicons name="image-outline" size={28} color={colors.textMuted} />
          <Text style={styles.mediaFallbackText}>Story image unavailable</Text>
        </View>
      )}

      {currentStory.caption ? <Text style={styles.caption}>{currentStory.caption}</Text> : null}

      <View style={styles.tapLayer}>
        <Pressable style={styles.tapZone} onPress={handlePrev} />
        <Pressable style={styles.tapZone} onPress={handleNext} />
      </View>

      <View style={styles.bottomBar}>
        <Text style={styles.hint}>
          Tap left/right to navigate{isLastStory ? ' | right side replays' : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  progressRow: {
    position: 'absolute',
    top: 20,
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    gap: 6,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  topBar: {
    position: 'absolute',
    top: 32,
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
    backgroundColor: 'rgba(8,15,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  image: { width: '100%', height: '100%' },
  mediaFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mediaFallbackText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  videoFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoFallbackText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  caption: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 82,
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
  },
  tapLayer: {
    ...StyleSheet.absoluteFillObject,
    top: 80,
    bottom: 70,
    zIndex: 3,
    flexDirection: 'row',
  },
  tapZone: {
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 26,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  hint: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    textAlign: 'center',
  },
  error: {
    color: colors.error,
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
