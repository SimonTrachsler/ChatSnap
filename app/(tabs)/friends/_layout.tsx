import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';
import { STACK_TRANSITION_OPTIONS } from '@/ui/navigationTransitions';

export default function FriendsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.bg,
        },
        ...STACK_TRANSITION_OPTIONS,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="search" />
      <Stack.Screen name="requests" />
      <Stack.Screen name="groups/create" />
      <Stack.Screen name="chat/[userId]" />
      <Stack.Screen name="detail/[friendId]" />
    </Stack>
  );
}
