-- =============================================================================
-- chat_messages.read_at + mark_thread_read RPC + count_unread_messages RPC
-- + snaps Realtime publication
-- =============================================================================

-- 1) Add read_at column to chat_messages
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS chat_messages_unread_idx
  ON public.chat_messages (thread_id, sender_id)
  WHERE read_at IS NULL;

-- 2) RLS: only the non-sender participant can set read_at
CREATE POLICY "chat_messages_update_read_at"
  ON public.chat_messages FOR UPDATE TO authenticated
  USING (
    sender_id <> auth.uid()
    AND exists (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id AND (t.user_a = auth.uid() OR t.user_b = auth.uid())
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
  );

-- 3) RPC: mark_thread_read – marks all unread messages from the other person as read
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_messages
  SET read_at = now()
  WHERE thread_id = p_thread_id
    AND sender_id <> auth.uid()
    AND read_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.mark_thread_read(uuid) IS
  'Marks all unread messages in a thread from the other user as read. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.mark_thread_read(uuid) TO authenticated;

-- 4) RPC: count_unread_messages – counts all unread chat messages across all threads
CREATE OR REPLACE FUNCTION public.count_unread_messages()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.chat_messages m
  JOIN public.chat_threads t ON t.id = m.thread_id
  WHERE m.read_at IS NULL
    AND m.sender_id <> auth.uid()
    AND (t.user_a = auth.uid() OR t.user_b = auth.uid());
$$;

COMMENT ON FUNCTION public.count_unread_messages() IS
  'Returns count of unread chat messages for the current user across all threads. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.count_unread_messages() TO authenticated;

-- 5) Add snaps to Realtime publication (if not already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'snaps'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.snaps;
  END IF;
END;
$$;
