/**
 * Supabase Database Types
 * Generiere mit: npx supabase gen types typescript --project-id <id> > src/types/database.ts
 *
 * -----------------------------------------------------------------------------
 * SCHEMA SUMMARY: friends and requests (public.profiles, friend_requests, friends)
 * -----------------------------------------------------------------------------
 *
 * public.profiles
 *   - id            uuid PK, references auth.users(id) ON DELETE CASCADE
 *   - username      text NOT NULL, UNIQUE (profiles_username_key)
 *   - email         text NOT NULL, UNIQUE (profiles_email_key)
 *   - created_at    timestamptz NOT NULL DEFAULT now()
 *   - RLS: select/insert/update own row only (id = auth.uid())
 *   - Trigger: auth.users AFTER INSERT → handle_new_auth_user() ensures profile row
 *
 * public.friend_requests
 *   - id            uuid PK DEFAULT gen_random_uuid()
 *   - requester_id  uuid NOT NULL, references profiles(id) ON DELETE CASCADE
 *   - receiver_id   uuid NOT NULL, references profiles(id) ON DELETE CASCADE
 *   - status        text NOT NULL DEFAULT 'pending', CHECK (pending|accepted|declined)
 *   - created_at    timestamptz NOT NULL DEFAULT now()
 *   - CHECK requester_id <> receiver_id; one pending per unordered pair (partial unique: friend_requests_unique_pending_pair)
 *   - RLS: select as requester or receiver; insert as requester; update as receiver (accepted|declined) or requester (declined/withdraw)
 *
 * public.friends (two rows per friendship: A->B and B->A)
 *   - id            uuid PK DEFAULT gen_random_uuid()
 *   - user_id       uuid NOT NULL, references profiles(id) ON DELETE CASCADE
 *   - friend_id     uuid NOT NULL, references profiles(id) ON DELETE CASCADE
 *   - created_at    timestamptz NOT NULL DEFAULT now()
 *   - CHECK user_id <> friend_id; UNIQUE (user_id, friend_id)
 *   - RLS: select where user_id = auth.uid(); insert when accepted request; delete where user_id = auth.uid()
 *   - Snaps: trigger checks friends where user_id = sender and friend_id = recipient
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; username: string | null; email: string | null; avatar_url: string | null; bio: string | null; onboarding_completed: boolean; created_at: string };
        Insert: { id: string; username?: string | null; email?: string | null; avatar_url?: string | null; bio?: string | null; onboarding_completed?: boolean; created_at?: string };
        Update: { id?: string; username?: string | null; email?: string | null; avatar_url?: string | null; bio?: string | null; onboarding_completed?: boolean; created_at?: string };
      };
      friend_requests: {
        Row: {
          id: string;
          requester_id: string;
          receiver_id: string;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          receiver_id: string;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          requester_id?: string;
          receiver_id?: string;
          status?: string;
          created_at?: string;
        };
      };
      friends: {
        Row: { id: string; user_id: string; friend_id: string; created_at: string };
        Insert: { id?: string; user_id: string; friend_id: string; created_at?: string };
        Update: { id?: string; user_id?: string; friend_id?: string; created_at?: string };
      };
      snaps: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          media_url: string | null;
          opened: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id: string;
          media_url?: string | null;
          opened?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          recipient_id?: string;
          media_url?: string | null;
          opened?: boolean;
          created_at?: string;
        };
      };
      user_photos: {
        Row: {
          id: string;
          user_id: string;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          storage_path?: string;
          created_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          sender_id: string;
          receiver_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          receiver_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          receiver_id?: string;
          body?: string;
          created_at?: string;
        };
      };
      chat_threads: {
        Row: { id: string; user_a: string; user_b: string; created_at: string };
        Insert: { id?: string; user_a: string; user_b: string; created_at?: string };
        Update: { id?: string; user_a?: string; user_b?: string; created_at?: string };
      };
      chat_messages: {
        Row: {
          id: string;
          thread_id: string;
          sender_id: string;
          body: string;
          message_type: string;
          snap_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          sender_id: string;
          body: string;
          message_type?: string;
          snap_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          sender_id?: string;
          body?: string;
          message_type?: string;
          snap_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
      };
      call_sessions: {
        Row: {
          id: string;
          thread_id: string;
          caller_id: string;
          callee_id: string;
          provider: string;
          rtc_channel: string;
          status: string;
          created_at: string;
          accepted_at: string | null;
          started_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          thread_id: string;
          caller_id: string;
          callee_id: string;
          provider?: string;
          rtc_channel: string;
          status?: string;
          created_at?: string;
          accepted_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          thread_id?: string;
          caller_id?: string;
          callee_id?: string;
          provider?: string;
          rtc_channel?: string;
          status?: string;
          created_at?: string;
          accepted_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
        };
      };
      friend_aliases: {
        Row: { id: string; owner_id: string; friend_id: string; alias: string | null };
        Insert: { id?: string; owner_id: string; friend_id: string; alias?: string | null };
        Update: { id?: string; owner_id?: string; friend_id?: string; alias?: string | null };
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_profiles: {
        Args: { query: string | null };
        Returns: { id: string; username: string | null; avatar_url: string | null }[];
      };
      profiles_search: {
        Args: { search_email: string | null };
        Returns: { id: string; email: string | null }[];
      };
      profiles_get_email_by_username: {
        Args: { search_username: string };
        Returns: string;
      };
      accept_friend_request: {
        Args: { request_id: string };
        Returns: unknown;
      };
      get_or_create_thread: {
        Args: { other_user_id: string };
        Returns: string;
      };
      get_call_availability: {
        Args: { p_target_user_id: string };
        Returns: { available: boolean; reason: string }[];
      };
      mark_thread_read: {
        Args: { p_thread_id: string };
        Returns: void;
      };
      count_unread_messages: {
        Args: Record<string, never>;
        Returns: number;
      };
      get_discover_users: {
        Args: { p_limit?: number | null };
        Returns: { id: string; username: string | null; avatar_url: string | null }[];
      };
      get_friend_stats: {
        Args: { p_other_user_id: string };
        Returns: { messages_total: number; snaps_total: number; score_total: number };
      };
      get_my_stats: {
        Args: Record<string, never>;
        Returns: { messages_total: number; snaps_total: number; score_total: number };
      };
      get_user_stats: {
        Args: { p_target_user_id: string };
        Returns: { messages_total: number; snaps_total: number; score_total: number };
      };
    };
    Enums: Record<string, never>;
  };
}
