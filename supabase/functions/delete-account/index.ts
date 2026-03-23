import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Missing Authorization header.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client with user's JWT to verify identity
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const userEmail = user.email;

    // Verify password via re-authentication
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'Password is required.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseReauth = createClient(supabaseUrl, supabaseAnonKey);
    const { error: signInError } = await supabaseReauth.auth.signInWithPassword({
      email: userEmail!,
      password,
    });
    if (signInError) {
      return new Response(JSON.stringify({ success: false, error: 'Wrong password.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Admin client with service role for deletion
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Delete storage files (best-effort: ignore errors on individual deletions)
    const buckets = ['avatars', 'user-photos', 'snaps'];
    for (const bucket of buckets) {
      const { data: files } = await supabaseAdmin.storage.from(bucket).list(userId);
      if (files?.length) {
        const paths = files.map((f: { name: string }) => `${userId}/${f.name}`);
        await supabaseAdmin.storage.from(bucket).remove(paths);
      }
    }

    // For snaps sent by the user, extract storage paths and delete
    const { data: sentSnaps } = await supabaseAdmin
      .from('snaps')
      .select('media_url')
      .eq('sender_id', userId);
    if (sentSnaps?.length) {
      for (const snap of sentSnaps as { media_url: string }[]) {
        const mediaUrl = snap.media_url ?? '';
        const match = mediaUrl.match(/\/snaps\/(.+?)(?:\?|$)/);
        const storagePath = match?.[1] ? decodeURIComponent(match[1]) : mediaUrl;
        const normalizedPath = storagePath.split('?')[0];
        if (normalizedPath) {
          await supabaseAdmin.storage.from('snaps').remove([normalizedPath]);
        }
      }
    }

    // Explicit cleanup before CASCADE deletion for safety
    await supabaseAdmin.from('chat_messages').delete().eq('sender_id', userId);
    await supabaseAdmin.from('chat_threads').delete().or(`user_a.eq.${userId},user_b.eq.${userId}`);
    await supabaseAdmin.from('friend_requests').delete().or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
    await supabaseAdmin.from('friends').delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    await supabaseAdmin.from('snaps').delete().or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);

    // Delete profile row — CASCADE handles any remaining references
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    // Delete auth user
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('Failed to delete auth user:', deleteAuthError.message);
      return new Response(JSON.stringify({ success: false, error: 'Failed to delete account. Please try again.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('delete-account error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
