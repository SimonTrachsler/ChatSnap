/**
 * Standardized Supabase/PostgREST error handling.
 * Maps known codes and HTTP status to German user messages.
 * Never exposes raw stack traces or internal messages in the UI.
 */

export type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: number;
};

const MSG = {
  auth: 'Bitte erneut anmelden.',
  forbidden: 'Keine Berechtigung für diese Aktion.',
  conflict: 'Eintrag existiert bereits.',
  conflictFriendRequest: 'Request already sent.',
  selfAddFriend: "You can't add yourself.",
  friendRequestPermission: "You don't have permission to send this request.",
  friendRequestUserNotFound: 'User not found or invalid.',
  chatFriendsOnly: 'Chat is only available for friends.',
  groupNotAdmin: 'Only group admins can do this.',
  groupMemberMustBeFriend: 'You can only add friends to a group.',
  groupOwnerCannotBeRemoved: 'The group owner cannot be removed.',
  groupOwnerCannotLeave: 'The group owner cannot leave the group.',
  rateLimit: 'Zu viele Anfragen. Bitte kurz warten.',
  generic: 'Etwas ist schiefgelaufen. Bitte später erneut versuchen.',
} as const;

export type ErrorContext = 'default' | 'friend_request';

/**
 * Returns a safe German message for the user. Never returns stack traces or raw error text.
 * Handles: 401/403 (auth/RLS), 409 / 23505 (conflict), 429 (rate limit).
 * @param context 'friend_request' uses a specific conflict message for duplicate requests.
 */
export function supabaseErrorToUserMessage(
  error: unknown,
  context: ErrorContext = 'default'
): string {
  if (error == null) return MSG.generic;

  const e = error as SupabaseLikeError;
  const code = e?.code;
  const status = e?.status ?? e?.statusCode;
  const msg = typeof e?.message === 'string' ? e.message : '';

  // HTTP status (Supabase/PostgREST may expose status or statusCode)
  if (typeof status === 'number') {
    if (status === 401) return MSG.auth;
    if (status === 403) return context === 'friend_request' ? MSG.friendRequestPermission : MSG.forbidden;
    if (status === 409) return context === 'friend_request' ? MSG.conflictFriendRequest : MSG.conflict;
    if (status === 429) return MSG.rateLimit;
  }

  // PostgreSQL / PostgREST codes
  if (code === '23505')
    return context === 'friend_request' ? MSG.conflictFriendRequest : MSG.conflict;
  if (code === '23514' && context === 'friend_request') return MSG.selfAddFriend; // check constraint (e.g. requester_id <> receiver_id)
  if (code === '23503' && context === 'friend_request') return MSG.friendRequestUserNotFound; // FK violation
  if (code === '42501') return context === 'friend_request' ? MSG.friendRequestPermission : MSG.forbidden;
  if (code === 'PGRST301' || code === 'PGRST302') return MSG.auth;

  // Message hints (avoid leaking internals; only use for known patterns)
  const lower = msg.toLowerCase();
  if (code === 'P0001' && lower.includes('only friends can open a chat')) return MSG.chatFriendsOnly;
  if (code === 'P0001' && lower.includes('group_not_admin')) return MSG.groupNotAdmin;
  if (code === 'P0001' && lower.includes('group_member_must_be_friend')) return MSG.groupMemberMustBeFriend;
  if (code === 'P0001' && lower.includes('group_owner_cannot_be_removed')) return MSG.groupOwnerCannotBeRemoved;
  if (code === 'P0001' && lower.includes('group_owner_cannot_leave')) return MSG.groupOwnerCannotLeave;
  if (code === 'P0001' && lower.includes('rate_limit_chat_messages')) return MSG.rateLimit;
  if (code === 'P0001' && lower.includes('rate_limit_snaps')) return MSG.rateLimit;
  if (lower.includes('jwt') && (lower.includes('expired') || lower.includes('invalid')))
    return MSG.auth;
  if (lower.includes('rate limit') || lower.includes('too many')) return MSG.rateLimit;
  if (lower.includes('only friends can open a chat')) return MSG.chatFriendsOnly;

  return MSG.generic;
}

