import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';
import {
  acceptCallSession,
  CALL_RING_TIMEOUT_MS,
  cancelCallSession,
  declineCallSession,
  endCallSession,
  failCallSession,
  getCallSession,
  markMissedCallSession,
  requestCallToken,
  subscribeToCallSession,
  type CallSession,
  type CallTokenResponse,
} from '@/lib/calls';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { colors, radius, spacing } from '@/ui/theme';

const TERMINAL_STATUSES = new Set(['declined', 'missed', 'cancelled', 'failed', 'ended']);

function resolveSessionId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) return value[0].trim();
  return null;
}

function humanStatus(status: string): string {
  switch (status) {
    case 'ringing':
      return 'Ringing';
    case 'accepted':
      return 'In call';
    case 'declined':
      return 'Declined';
    case 'missed':
      return 'Missed';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    case 'ended':
      return 'Ended';
    default:
      return status;
  }
}

function parseAgoraUid(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function noteFromTokenResponse(tokenRes: CallTokenResponse): string {
  if (!tokenRes.success) return tokenRes.message ?? 'Token request failed.';
  if (!tokenRes.token) {
    return tokenRes.message ?? 'Joined without token. Configure AGORA_APP_CERTIFICATE for production.';
  }
  return 'Secure audio token ready.';
}

async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export default function CallSessionScreen() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = resolveSessionId(params.sessionId);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const myId = useAuthStore((s) => s.user?.id) ?? null;

  const [session, setSession] = useState<CallSession | null>(null);
  const [peerName, setPeerName] = useState<string>('Friend');
  const [tokenNote, setTokenNote] = useState<string>('Preparing call...');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rtcState, setRtcState] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle');
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);

  const engineRef = useRef<IRtcEngine | null>(null);
  const eventHandlerRef = useRef<IRtcEngineEventHandler | null>(null);
  const joinedRef = useRef(false);
  const joinInProgressRef = useRef(false);
  const skipBeforeRemoveRef = useRef(false);

  const leaveRtc = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      joinedRef.current = false;
      joinInProgressRef.current = false;
      setRtcState('idle');
      setRemoteUid(null);
      return;
    }

    try {
      if (eventHandlerRef.current) {
        engine.unregisterEventHandler(eventHandlerRef.current);
      }
    } catch {
      // Ignore cleanup errors while tearing down the call engine.
    }

    try {
      if (joinedRef.current) {
        engine.leaveChannel();
      }
    } catch {
      // Ignore cleanup errors while leaving the RTC channel.
    }

    try {
      engine.release();
    } catch {
      // Ignore cleanup errors while releasing native resources.
    }

    engineRef.current = null;
    eventHandlerRef.current = null;
    joinedRef.current = false;
    joinInProgressRef.current = false;
    setRtcState('idle');
    setRemoteUid(null);
  }, []);

  const renewRtcToken = useCallback(async (targetSessionId: string) => {
    const engine = engineRef.current;
    if (!engine) return;

    try {
      const tokenRes = await requestCallToken(targetSessionId);
      if (tokenRes.token) {
        engine.renewToken(tokenRes.token);
        setTokenNote('Audio token renewed.');
      }
    } catch (tokenError) {
      console.warn('[call] token renew failed', tokenError);
    }
  }, []);

  const joinRtcAudio = useCallback(async (targetSession: CallSession) => {
    if (joinedRef.current || joinInProgressRef.current) return;
    joinInProgressRef.current = true;
    setRtcState('connecting');
    setError(null);

    try {
      const hasMicPermission = await ensureMicrophonePermission();
      if (!hasMicPermission) {
        throw new Error('Microphone permission was denied.');
      }

      const tokenRes = await requestCallToken(targetSession.id);
      if (!tokenRes.success) {
        throw new Error(tokenRes.message ?? 'Token request failed.');
      }
      if (!tokenRes.appId) {
        throw new Error('Missing Agora app ID.');
      }
      if (!tokenRes.channel) {
        throw new Error('Missing Agora channel.');
      }

      setTokenNote(noteFromTokenResponse(tokenRes));
      const uid = parseAgoraUid(tokenRes.uid);

      leaveRtc();
      const engine = createAgoraRtcEngine();
      const handler: IRtcEngineEventHandler = {
        onJoinChannelSuccess: () => {
          setRtcState('connected');
        },
        onUserJoined: (_connection, nextRemoteUid) => {
          setRemoteUid(nextRemoteUid);
        },
        onUserOffline: (_connection, nextRemoteUid) => {
          setRemoteUid((prev) => (prev === nextRemoteUid ? null : prev));
        },
        onLeaveChannel: () => {
          setRtcState('idle');
          setRemoteUid(null);
          joinedRef.current = false;
        },
        onTokenPrivilegeWillExpire: () => {
          void renewRtcToken(targetSession.id);
        },
        onRequestToken: () => {
          void renewRtcToken(targetSession.id);
        },
        onError: (err, msg) => {
          setRtcState('failed');
          setError(`Audio error (${err}): ${msg}`);
        },
      };

      engine.registerEventHandler(handler);
      eventHandlerRef.current = handler;
      engineRef.current = engine;

      const initResult = engine.initialize({
        appId: tokenRes.appId,
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
      });
      if (initResult < 0) {
        throw new Error(`Agora init failed (${initResult}).`);
      }

      engine.enableAudio();
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.setEnableSpeakerphone(speakerEnabled);
      engine.muteLocalAudioStream(micMuted);

      const joinResult = engine.joinChannel(tokenRes.token ?? '', tokenRes.channel, uid, {
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        publishCameraTrack: false,
        autoSubscribeAudio: true,
        autoSubscribeVideo: false,
        enableAudioRecordingOrPlayout: true,
      });

      if (joinResult < 0) {
        throw new Error(`Agora join failed (${joinResult}).`);
      }

      joinedRef.current = true;
      setTokenNote(tokenRes.token ? 'Connected with secure token.' : 'Connected without token (debug mode).');
    } catch (joinError) {
      setRtcState('failed');
      setRemoteUid(null);
      leaveRtc();
      try {
        await failCallSession(targetSession.id);
      } catch (markFailedError) {
        console.warn('[call] failed to mark session as failed', markFailedError);
      }
      throw joinError;
    } finally {
      joinInProgressRef.current = false;
    }
  }, [leaveRtc, micMuted, renewRtcToken, speakerEnabled]);

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setError('Missing call session.');
      setLoading(false);
      return;
    }

    try {
      const nextSession = await getCallSession(sessionId);
      setSession(nextSession);
      if (!nextSession) {
        setError('Call session not found.');
        setLoading(false);
        return;
      }

      const peerId = myId === nextSession.caller_id ? nextSession.callee_id : nextSession.caller_id;
      if (peerId) {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', peerId)
          .maybeSingle();
        const username = (data as { username?: string | null } | null)?.username ?? null;
        setPeerName(username ?? 'Friend');
      }

      try {
        const tokenRes = await requestCallToken(nextSession.id);
        setTokenNote(noteFromTokenResponse(tokenRes));
      } catch {
        setTokenNote('Token function not reachable. Deploy create-call-token first.');
      }

      setLoading(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not load call session.';
      setError(message);
      setLoading(false);
    }
  }, [myId, sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeToCallSession(sessionId, (nextSession) => {
      setSession(nextSession);
    });
  }, [sessionId]);

  useEffect(() => {
    if (!session || !myId) return;

    if (TERMINAL_STATUSES.has(session.status)) {
      leaveRtc();
      return;
    }

    if (session.status === 'accepted') {
      joinRtcAudio(session).catch((joinError) => {
        const message = joinError instanceof Error ? joinError.message : 'Could not connect audio call.';
        setError(message);
      });
      return;
    }

    if (session.status === 'ringing') {
      setRtcState('idle');
      setRemoteUid(null);
    }
  }, [joinRtcAudio, leaveRtc, myId, session]);

  useEffect(() => {
    if (!session || !TERMINAL_STATUSES.has(session.status)) return;
    const timer = setTimeout(() => {
      skipBeforeRemoveRef.current = true;
      router.back();
    }, 650);
    return () => clearTimeout(timer);
  }, [router, session]);

  useEffect(() => {
    if (!session?.id || session.status !== 'ringing') return;
    const createdAtMs = new Date(session.created_at).getTime();
    if (!Number.isFinite(createdAtMs)) return;

    const deadlineMs = createdAtMs + CALL_RING_TIMEOUT_MS;
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      markMissedCallSession(session.id)
        .catch((timeoutError) => {
          console.warn('[call] failed to mark missed after timeout', timeoutError);
        })
        .finally(() => {
          if (!cancelled) {
            leaveRtc();
            skipBeforeRemoveRef.current = true;
            router.back();
          }
        });
    }, remainingMs + 25);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leaveRtc, router, session?.created_at, session?.id, session?.status]);

  useEffect(() => () => {
    leaveRtc();
  }, [leaveRtc]);

  const handleAccept = useCallback(async () => {
    if (!session?.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptCallSession(session.id);
      setSession((prev) => (prev ? { ...prev, status: 'accepted' } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept call.');
    } finally {
      setBusy(false);
    }
  }, [busy, session?.id]);

  const handleDecline = useCallback(async () => {
    if (!session?.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await declineCallSession(session.id);
      leaveRtc();
      skipBeforeRemoveRef.current = true;
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline call.');
    } finally {
      setBusy(false);
    }
  }, [busy, leaveRtc, router, session?.id]);

  const handleEnd = useCallback(async () => {
    if (!session?.id || busy || session.status !== 'accepted') return;
    setBusy(true);
    setError(null);
    try {
      await endCallSession(session.id);
      leaveRtc();
      skipBeforeRemoveRef.current = true;
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end call.');
    } finally {
      setBusy(false);
    }
  }, [busy, leaveRtc, router, session?.id, session?.status]);

  const handleCancel = useCallback(async () => {
    if (!session?.id || busy || session.status !== 'ringing') return;
    setBusy(true);
    setError(null);
    try {
      await cancelCallSession(session.id);
      leaveRtc();
      skipBeforeRemoveRef.current = true;
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel call.');
    } finally {
      setBusy(false);
    }
  }, [busy, leaveRtc, router, session?.id, session?.status]);

  const finalizeBeforeExit = useCallback(async () => {
    if (!session?.id) {
      leaveRtc();
      return;
    }

    if (session.status === 'accepted') {
      try {
        await endCallSession(session.id);
      } catch {
        // Ignore and still leave the screen; session can be cleaned up remotely.
      }
    } else if (session.status === 'ringing') {
      try {
        if (myId === session.caller_id) {
          await cancelCallSession(session.id);
        } else {
          await declineCallSession(session.id);
        }
      } catch {
        // Ignore and still leave the screen.
      }
    }

    leaveRtc();
  }, [leaveRtc, myId, session]);

  const handleBack = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await finalizeBeforeExit();
      skipBeforeRemoveRef.current = true;
      router.back();
    } finally {
      setBusy(false);
    }
  }, [busy, finalizeBeforeExit, router]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (skipBeforeRemoveRef.current) {
        skipBeforeRemoveRef.current = false;
        return;
      }
      if (!session || TERMINAL_STATUSES.has(session.status)) {
        leaveRtc();
        return;
      }

      event.preventDefault();
      void (async () => {
        await finalizeBeforeExit();
        skipBeforeRemoveRef.current = true;
        navigation.dispatch(event.data.action);
      })();
    });
    return unsubscribe;
  }, [finalizeBeforeExit, leaveRtc, navigation, session]);

  const toggleMute = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !joinedRef.current) return;
    const nextMuted = !micMuted;
    const result = engine.muteLocalAudioStream(nextMuted);
    if (result >= 0) {
      setMicMuted(nextMuted);
    }
  }, [micMuted]);

  const toggleSpeaker = useCallback(() => {
    const engine = engineRef.current;
    const nextSpeaker = !speakerEnabled;
    if (engine && joinedRef.current) {
      const result = engine.setEnableSpeakerphone(nextSpeaker);
      if (result < 0) return;
    }
    setSpeakerEnabled(nextSpeaker);
  }, [speakerEnabled]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} size="small" />
        <Text style={styles.loadingText}>Preparing audio call...</Text>
      </View>
    );
  }

  if (error || !session) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.errorText}>{error ?? 'Call unavailable.'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.82}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isCallee = myId === session.callee_id;
  const isCaller = myId === session.caller_id;
  const canAccept = isCallee && session.status === 'ringing';
  const canDecline = isCallee && session.status === 'ringing';
  const canCancel = isCaller && session.status === 'ringing';
  const canEnd = session.status === 'accepted';
  const showAudioControls = session.status === 'accepted';
  const statusLine = remoteUid ? 'Friend connected' : 'Waiting for friend audio';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 20 }]}>
      <TouchableOpacity style={styles.backIcon} onPress={handleBack} activeOpacity={0.82}>
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.centerContent}>
        <View style={styles.avatarCircle}>
          <Ionicons name="call-outline" size={34} color={colors.accentSecondary} />
        </View>
        <Text style={styles.peerName}>{peerName}</Text>
        <Text style={styles.statusText}>{humanStatus(session.status)}</Text>
        <Text style={styles.metaText}>Audio: {rtcState}</Text>
        {showAudioControls ? <Text style={styles.metaText}>{statusLine}</Text> : null}
        <Text style={styles.noteText}>{tokenNote}</Text>
      </View>

      <View style={styles.actions}>
        {showAudioControls ? (
          <View style={styles.audioControls}>
            <TouchableOpacity style={styles.secondaryControlBtn} onPress={toggleMute} activeOpacity={0.84}>
              <Ionicons
                name={micMuted ? 'mic-off-outline' : 'mic-outline'}
                size={18}
                color={colors.textPrimary}
              />
              <Text style={styles.secondaryControlText}>{micMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryControlBtn} onPress={toggleSpeaker} activeOpacity={0.84}>
              <Ionicons
                name={speakerEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
                size={18}
                color={colors.textPrimary}
              />
              <Text style={styles.secondaryControlText}>{speakerEnabled ? 'Speaker' : 'Earpiece'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {canAccept ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.acceptBtn]}
            onPress={handleAccept}
            disabled={busy}
            activeOpacity={0.84}
          >
            <Ionicons name="call" size={20} color={colors.onAccent} />
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
        ) : null}
        {canDecline ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={handleDecline}
            disabled={busy}
            activeOpacity={0.84}
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
        ) : null}
        {canCancel ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={handleCancel}
            disabled={busy}
            activeOpacity={0.84}
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
            <Text style={styles.declineText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
        {canEnd ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.endBtn]}
            onPress={handleEnd}
            disabled={busy}
            activeOpacity={0.84}
          >
            <Ionicons name="call-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.endText}>End</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    gap: 10,
    paddingHorizontal: 24,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
    fontSize: 14,
  },
  backButton: {
    marginTop: 12,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md,
  },
  backButtonText: {
    color: colors.onAccent,
    fontWeight: '700',
  },
  backIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  peerName: {
    marginTop: 8,
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.accentSecondary,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  noteText: {
    marginTop: 8,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 320,
  },
  actions: {
    paddingBottom: 4,
    gap: 10,
  },
  audioControls: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryControlBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(148,163,184,0.16)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  secondaryControlText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  acceptBtn: {
    backgroundColor: colors.accent,
  },
  declineBtn: {
    backgroundColor: 'rgba(148,163,184,0.2)',
    borderWidth: 1,
    borderColor: colors.bgCardBorder,
  },
  endBtn: {
    backgroundColor: 'rgba(251,113,133,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.35)',
  },
  acceptText: {
    color: colors.onAccent,
    fontWeight: '700',
    fontSize: 16,
  },
  declineText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  endText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
