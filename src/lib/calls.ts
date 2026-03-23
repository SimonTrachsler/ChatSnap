import { getOrCreateThread } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type CallSessionRow = Database['public']['Tables']['call_sessions']['Row'];
type CallSessionInsert = Database['public']['Tables']['call_sessions']['Insert'];

export type CallSession = CallSessionRow;

export type CallTokenResponse = {
  success: boolean;
  provider: string;
  appId: string;
  channel: string;
  token: string | null;
  uid: string;
  expiresAt: string | null;
  message?: string;
};

const ACTIVE_CALL_STATUSES = ['ringing', 'accepted'];
export const CALL_RING_TIMEOUT_MS = 35_000;
const STALE_RINGING_MS = CALL_RING_TIMEOUT_MS + 5_000;
const CALL_READINESS_CACHE_MS = 60_000;
let callReadinessCache: { value: CallTokenResponse; expiresAt: number } | null = null;

async function requireMyUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) {
    throw new Error('Not authenticated.');
  }
  return user.id;
}

function makeRtcChannel(threadId: string): string {
  return `call-${threadId}-${Date.now()}`;
}

async function expireStaleRingingCalls(threadId: string): Promise<void> {
  const staleBeforeIso = new Date(Date.now() - STALE_RINGING_MS).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  await (supabase.from('call_sessions') as any)
    .update({ status: 'missed' })
    .eq('thread_id', threadId)
    .eq('status', 'ringing')
    .lt('created_at', staleBeforeIso);
}

async function findLatestActiveSession(threadId: string): Promise<CallSession | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for selects is narrower than runtime schema
  const { data, error } = await (supabase.from('call_sessions') as any)
    .select('*')
    .eq('thread_id', threadId)
    .in('status', ACTIVE_CALL_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CallSession | null) ?? null;
}

export async function createOutgoingCallSession(calleeId: string): Promise<CallSession> {
  const callerId = await requireMyUserId();
  if (callerId === calleeId) {
    throw new Error('You cannot call yourself.');
  }

  const threadId = await getOrCreateThread(calleeId);
  await expireStaleRingingCalls(threadId);

  const payload: CallSessionInsert = {
    thread_id: threadId,
    caller_id: callerId,
    callee_id: calleeId,
    provider: 'agora',
    rtc_channel: makeRtcChannel(threadId),
    status: 'ringing',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for inserts is narrower than runtime schema
  const { data, error } = await (supabase.from('call_sessions') as any)
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    const postgresCode = (error as { code?: string }).code;
    const errorMessage = (error as { message?: string }).message?.toLowerCase() ?? '';
    if (postgresCode === '23505') {
      const existing = await findLatestActiveSession(threadId);
      if (existing) {
        return existing;
      }
      throw new Error('A call with this friend is already active.');
    }
    if (errorMessage.includes('already in an active call')) {
      throw new Error('One of you is already in another active call.');
    }
    throw error;
  }
  return data as CallSession;
}

export async function getCallSession(sessionId: string): Promise<CallSession | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for selects is narrower than runtime schema
  const { data, error } = await (supabase.from('call_sessions') as any)
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as CallSession | null) ?? null;
}

export async function sweepAndGetLatestIncomingRingingCallSession(userId: string): Promise<CallSession | null> {
  const staleBeforeIso = new Date(Date.now() - CALL_RING_TIMEOUT_MS).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const sweep = await (supabase.from('call_sessions') as any)
    .update({ status: 'missed' })
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .lt('created_at', staleBeforeIso);
  if (sweep.error) throw sweep.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for selects is narrower than runtime schema
  const { data, error } = await (supabase.from('call_sessions') as any)
    .select('*')
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .gte('created_at', staleBeforeIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CallSession | null) ?? null;
}

export async function acceptCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'accepted' })
    .eq('id', sessionId)
    .eq('status', 'ringing');
  if (error) throw error;
}

export async function declineCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'declined' })
    .eq('id', sessionId)
    .eq('status', 'ringing');
  if (error) throw error;
}

export async function endCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'ended' })
    .eq('id', sessionId)
    .eq('status', 'accepted');
  if (error) throw error;
}

export async function cancelCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'cancelled' })
    .eq('id', sessionId)
    .eq('status', 'ringing');
  if (error) throw error;
}

export async function failCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'failed' })
    .eq('id', sessionId)
    .in('status', ACTIVE_CALL_STATUSES);
  if (error) throw error;
}

export async function markMissedCallSession(sessionId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local client typing for updates is narrower than runtime schema
  const { error } = await (supabase.from('call_sessions') as any)
    .update({ status: 'missed' })
    .eq('id', sessionId)
    .eq('status', 'ringing');
  if (error) throw error;
}

export function subscribeToCallSession(
  sessionId: string,
  onChange: (session: CallSession | null) => void,
): () => void {
  const channel = supabase
    .channel(`call_session:${sessionId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'call_sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          onChange(null);
          return;
        }
        onChange(payload.new as CallSession);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToIncomingCallSessions(
  userId: string,
  onIncoming: (session: CallSession) => void,
): () => void {
  const channel = supabase
    .channel(`incoming_calls:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${userId}` },
      (payload) => {
        const session = payload.new as CallSession;
        if (session.status === 'ringing') {
          onIncoming(session);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function requestCallToken(sessionId: string): Promise<CallTokenResponse> {
  const { data, error } = await supabase.functions.invoke<CallTokenResponse>('create-call-token', {
    body: { sessionId },
  });
  if (error) throw error;
  if (!data) throw new Error('No call token response.');
  return data;
}

export async function probeCallReadiness(options?: { forceRefresh?: boolean }): Promise<CallTokenResponse> {
  const forceRefresh = options?.forceRefresh === true;
  if (!forceRefresh && callReadinessCache && Date.now() < callReadinessCache.expiresAt) {
    return callReadinessCache.value;
  }

  const { data, error } = await supabase.functions.invoke<CallTokenResponse>('create-call-token', {
    body: { probe: true },
  });
  if (error) throw error;
  if (!data) throw new Error('No call readiness response.');
  callReadinessCache = {
    value: data,
    expiresAt: Date.now() + CALL_READINESS_CACHE_MS,
  };
  return data;
}
