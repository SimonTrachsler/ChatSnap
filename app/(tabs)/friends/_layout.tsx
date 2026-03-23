import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';

export default function FriendsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.bg,
        },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="search" />
      <Stack.Screen name="requests" />
      <Stack.Screen name="chat/[userId]" />
      <Stack.Screen name="detail/[friendId]" />
    </Stack>
  );
}
