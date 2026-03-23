import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';

export default function InboxLayout() {
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
      <Stack.Screen name="chat/[userId]" />
    </Stack>
  );
}
