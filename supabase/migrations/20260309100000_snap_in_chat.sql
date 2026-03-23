-- Add snap message support to chat_messages
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS snap_id uuid REFERENCES snaps(id) ON DELETE SET NULL;
