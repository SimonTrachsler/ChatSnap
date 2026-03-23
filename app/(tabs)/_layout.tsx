import { useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFriendRequestsStore } from '@/store/useFriendRequestsStore';
import { useInboxBadgeStore } from '@/store/useInboxBadgeStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useAuthStore } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
import { colors, radius, shadows } from '@/ui/theme';
import { getFloatingTabBarMetrics } from '@/ui/tabBar';
import { TABS_TRANSITION_OPTIONS } from '@/ui/navigationTransitions';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const pendingIncomingCount = useFriendRequestsStore((s) => s.pendingIncomingCount);
  const refreshPendingIncoming = useFriendRequestsStore((s) => s.refreshPendingIncoming);
  const unreadMessages = useInboxBadgeStore((s) => s.unreadMessages);
  const refreshUnreadMessages = useInboxBadgeStore((s) => s.refreshUnreadMessages);
  const setUnreadMessages = useInboxBadgeStore((s) => s.setUnreadMessages);
  const profileError = useProfileStore((s) => s.profileError);
  const profileLoading = useProfileStore((s) => s.profileLoading);
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const tabBarMetrics = getFloatingTabBarMetrics(insets);

  const refreshInboxBadge = useCallback(async () => {
    if (!userId) {
      setUnreadMessages(0);
      return;
    }
    await refreshPendingIncoming();
    await refreshUnreadMessages();
  }, [userId, refreshPendingIncoming, refreshUnreadMessages, setUnreadMessages]);

  useEffect(() => { refreshPendingIncoming(); }, [refreshPendingIncoming]);
  useEffect(() => { refreshInboxBadge(); }, [refreshInboxBadge]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('global-friend-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        () => { refreshPendingIncoming(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, refreshPendingIncoming]);

  const inboxBadgeTotal = unreadMessages;

  if (profileError && !profileLoading) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Profile error</Text>
        <Text style={styles.errorText}>{profileError}</Text>
        <TouchableOpacity
          style={styles.errorButton}
          onPress={async () => {
            try {
              await supabase.auth.signOut({ scope: 'local' });
            } catch {
              useAuthStore.getState().setAuth(null);
            }
          }}
        >
          <Text style={styles.errorButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        ...TABS_TRANSITION_OPTIONS,
        sceneStyle: {
          backgroundColor: 'transparent',
        },
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: tabBarMetrics.bottom,
          backgroundColor: colors.tabBar,
          borderTopWidth: 1,
          borderTopColor: colors.bgCardBorder,
          height: tabBarMetrics.height,
          paddingBottom: tabBarMetrics.paddingBottom,
          paddingTop: 8,
          borderRadius: radius.xl,
          ...shadows.floating,
          elevation: 0,
        },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
        tabBarBadgeStyle: {
          backgroundColor: colors.accent,
          fontSize: 10,
          fontWeight: '800',
          color: colors.onAccent,
          top: 6,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
      }}
    >
      {/* Order: Friends | Inbox | Camera (center) | Gallery | Settings */}
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarLabel: 'Friends',
          tabBarIcon: ({ color }) => (
            <Ionicons name="people" size={26} color={color} />
          ),
          tabBarBadge: pendingIncomingCount > 0
            ? (pendingIncomingCount > 99 ? '99+' : pendingIncomingCount)
            : undefined,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarLabel: 'Inbox',
          tabBarIcon: ({ color }) => (
            <Ionicons name="chatbubbles" size={26} color={color} />
          ),
          tabBarBadge: inboxBadgeTotal > 0
            ? (inboxBadgeTotal > 99 ? '99+' : inboxBadgeTotal)
            : undefined,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Camera',
          tabBarLabel: '',
          tabBarIcon: ({ focused }) => (
            <View style={[styles.cameraBtn, focused && styles.cameraBtnActive]}>
              <Ionicons name="camera" size={28} color={focused ? colors.onAccent : colors.textPrimary} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: 'Gallery',
          tabBarLabel: 'Gallery',
          tabBarIcon: ({ color }) => (
            <Ionicons name="images-outline" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => (
            <Ionicons name="settings-outline" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="photo-preview"
        options={{
          href: null,
          title: 'PhotoPreview',
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="snap-send"
        options={{
          href: null,
          title: 'SnapSend',
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  cameraBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.bgCardAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    borderWidth: 2,
    borderColor: colors.bgCardBorder,
    ...shadows.card,
  },
  cameraBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  errorButton: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: radius.md,
  },
  errorButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.bg,
  },
});
