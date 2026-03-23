import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import agoraToken from 'npm:agora-token@2.0.5';

const { RtcRole, RtcTokenBuilder } = agoraToken as {
  RtcRole: { PUBLISHER: number };
  RtcTokenBuilder: {
    buildTokenWithUid: (
      appId: string,
      appCertificate: string,
      channelName: string,
      uid: number | string,
      role: number,
      tokenExpire: number,
      privilegeExpire: number,
    ) => string;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CallSessionRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  rtc_channel: string;
  status: string;
  provider: string;
};

type TokenResponse = {
  success: boolean;
  provider: string;
  appId: string;
  channel: string;
  token: string | null;
  uid: string;
  expiresAt: string | null;
  message?: string;
};

type TokenRequestBody = {
  sessionId?: string;
  probe?: boolean;
};

function userIdToAgoraUid(userId: string): number {
  // Deterministic FNV-1a hash so each user always gets the same numeric UID.
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

function readPositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method not allowed.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, message: 'Missing authorization header.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const agoraAppId = Deno.env.get('AGORA_APP_ID') ?? '';
    const agoraAppCertificate = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ success: false, message: 'Supabase env vars are incomplete.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, message: 'Invalid authorization header.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired session.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json().catch(() => ({}))) as TokenRequestBody;
    const probe = body?.probe === true;

    if (probe) {
      const isReady = Boolean(agoraAppId && agoraAppCertificate);
      const probeResponse: TokenResponse = {
        success: isReady,
        provider: 'agora',
        appId: agoraAppId,
        channel: '',
        token: null,
        uid: String(userIdToAgoraUid(user.id)),
        expiresAt: null,
        message: isReady
          ? 'Agora call infrastructure is ready.'
          : 'Audio calls are not configured yet. Missing AGORA_APP_ID and/or AGORA_APP_CERTIFICATE.',
      };
      return new Response(JSON.stringify(probeResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) {
      return new Response(JSON.stringify({ success: false, message: 'sessionId is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('call_sessions')
      .select('id, caller_id, callee_id, rtc_channel, status, provider')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ success: false, message: 'Call session not found.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const typedSession = session as CallSessionRow;
    if (typedSession.caller_id !== user.id && typedSession.callee_id !== user.id) {
      return new Response(JSON.stringify({ success: false, message: 'Not allowed for this call session.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['ringing', 'accepted'].includes(typedSession.status)) {
      return new Response(JSON.stringify({ success: false, message: 'Call is no longer active.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typedSession.provider !== 'agora') {
      return new Response(JSON.stringify({ success: false, message: 'Only agora provider is supported.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!agoraAppId) {
      return new Response(JSON.stringify({ success: false, message: 'AGORA_APP_ID is missing.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const uid = userIdToAgoraUid(user.id);
    const expiresInSeconds = readPositiveInt(Deno.env.get('AGORA_TOKEN_TTL_SECONDS'), 3600);
    let token: string | null = null;
    let expiresAt: string | null = null;
    let message: string | undefined;

    if (agoraAppCertificate) {
      try {
        token = RtcTokenBuilder.buildTokenWithUid(
          agoraAppId,
          agoraAppCertificate,
          typedSession.rtc_channel,
          uid,
          RtcRole.PUBLISHER,
          expiresInSeconds,
          expiresInSeconds,
        );
        expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      } catch (tokenError) {
        const tokenMessage = tokenError instanceof Error ? tokenError.message : 'Unknown token builder error.';
        return new Response(JSON.stringify({ success: false, message: `Failed to build Agora token: ${tokenMessage}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      message = 'AGORA_APP_CERTIFICATE missing. Returning appId/channel only (debug mode without token).';
    }

    const response: TokenResponse = {
      success: true,
      provider: 'agora',
      appId: agoraAppId,
      channel: typedSession.rtc_channel,
      token,
      uid: String(uid),
      expiresAt,
      message,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('[create-call-token] error', message);
    return new Response(JSON.stringify({ success: false, message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
