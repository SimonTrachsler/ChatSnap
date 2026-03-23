import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-reset-secret',
};

type StorageItem = {
  id?: string;
  name: string;
};

async function emptyBucket(supabaseAdmin: ReturnType<typeof createClient>, bucketId: string): Promise<number> {
  const folders: string[] = [''];
  const objectPaths: string[] = [];

  while (folders.length > 0) {
    const folder = folders.shift() ?? '';
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucketId)
        .list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      const items = (data ?? []) as StorageItem[];
      if (items.length === 0) {
        hasMore = false;
        continue;
      }

      for (const item of items) {
        const isObject = Boolean(item.id);
        const fullPath = folder ? `${folder}/${item.name}` : item.name;
        if (isObject) objectPaths.push(fullPath);
        else folders.push(fullPath);
      }

      offset += items.length;
      if (items.length < 1000) hasMore = false;
    }
  }

  for (let i = 0; i < objectPaths.length; i += 1000) {
    const batch = objectPaths.slice(i, i + 1000);
    const { error } = await supabaseAdmin.storage.from(bucketId).remove(batch);
    if (error) throw error;
  }

  return objectPaths.length;
}

async function deleteAllAuthUsers(supabaseAdmin: ReturnType<typeof createClient>): Promise<number> {
  let totalDeleted = 0;
  let hasMoreUsers = true;

  while (hasMoreUsers) {
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    if (!users?.length) {
      hasMoreUsers = false;
      continue;
    }

    for (const user of users) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (error) throw error;
      totalDeleted += 1;
    }
  }

  return totalDeleted;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = Deno.env.get('ADMIN_RESET_SECRET');
  const headerSecret = req.headers.get('x-admin-reset-secret');
  if (!secret || headerSecret !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const buckets = ['avatars', 'user-photos', 'snaps'];
    const bucketStats: Record<string, number> = {};
    for (const bucket of buckets) {
      bucketStats[bucket] = await emptyBucket(supabaseAdmin, bucket);
    }
    const totalDeleted = await deleteAllAuthUsers(supabaseAdmin);

    return new Response(JSON.stringify({ success: true, authUsersDeleted: totalDeleted, bucketStats }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('admin-reset error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
