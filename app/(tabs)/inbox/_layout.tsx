import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';
import { STACK_TRANSITION_OPTIONS } from '@/ui/navigationTransitions';

export default function InboxLayout() {
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
      <Stack.Screen name="chat/[userId]" />
    </Stack>
  );
}
