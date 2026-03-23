-- =============================================================================
-- friend_aliases: per-user nicknames for friends (visible only to owner)
-- =============================================================================

CREATE TABLE public.friend_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alias text,
  CONSTRAINT friend_aliases_unique UNIQUE (owner_id, friend_id),
  CONSTRAINT friend_aliases_self CHECK (owner_id <> friend_id)
);

ALTER TABLE public.friend_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friend_aliases_owner" ON public.friend_aliases
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
