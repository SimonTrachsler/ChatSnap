import { ThreadChatScreen } from '@/features/chat/ThreadChatScreen';

export default function InboxChatRoute() {
  return <ThreadChatScreen backHref="/(tabs)/inbox" showProfileLink />;
}
