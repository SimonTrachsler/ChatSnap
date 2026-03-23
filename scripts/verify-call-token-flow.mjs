#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

function env(name) {
  return (process.env[name] || '').trim();
}

function fail(message) {
  console.error(`[verify-call-token-flow] ${message}`);
  process.exit(1);
}

function rand(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len);
}

const url = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
const anon = env('EXPO_PUBLIC_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY');
const expectedAgoraAppId = env('AGORA_APP_ID');

if (!url) fail('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
if (!anon) fail('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY.');
if (!serviceRole) fail('Missing SUPABASE_SERVICE_ROLE_KEY.');

const admin = createClient(url, serviceRole);
const anonClient = createClient(url, anon);

let callerId = null;
let calleeId = null;

async function cleanup() {
  if (callerId) {
    await admin.auth.admin.deleteUser(callerId);
  }
  if (calleeId) {
    await admin.auth.admin.deleteUser(calleeId);
  }
}

async function run() {
  const callerEmail = `tokencheck_caller_${Date.now()}_${rand()}@example.com`;
  const calleeEmail = `tokencheck_callee_${Date.now()}_${rand()}@example.com`;
  const password = `TempPass!${Math.floor(Math.random() * 1_000_000)}`;

  const createCaller = await admin.auth.admin.createUser({
    email: callerEmail,
    password,
    email_confirm: true,
  });
  if (createCaller.error || !createCaller.data.user) {
    fail(`create caller failed: ${createCaller.error?.message || 'unknown'}`);
  }
  callerId = createCaller.data.user.id;

  const createCallee = await admin.auth.admin.createUser({
    email: calleeEmail,
    password,
    email_confirm: true,
  });
  if (createCallee.error || !createCallee.data.user) {
    fail(`create callee failed: ${createCallee.error?.message || 'unknown'}`);
  }
  calleeId = createCallee.data.user.id;

  await admin.from('profiles').update({ username: `caller_${rand(6)}` }).eq('id', callerId);
  await admin.from('profiles').update({ username: `callee_${rand(6)}` }).eq('id', calleeId);

  const insFriends = await admin.from('friends').insert([
    { user_id: callerId, friend_id: calleeId },
    { user_id: calleeId, friend_id: callerId },
  ]);
  if (insFriends.error) {
    fail(`insert friends failed: ${insFriends.error.message}`);
  }

  const signInCaller = await anonClient.auth.signInWithPassword({ email: callerEmail, password });
  if (signInCaller.error || !signInCaller.data.session) {
    fail(`caller sign in failed: ${signInCaller.error?.message || 'no session'}`);
  }

  const callerClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${signInCaller.data.session.access_token}` } },
  });

  const thread = await callerClient.rpc('get_or_create_thread', { other_user_id: calleeId });
  if (thread.error || !thread.data) {
    fail(`get_or_create_thread failed: ${thread.error?.message || 'no thread id'}`);
  }
  const threadId = thread.data;

  const callSession = await callerClient
    .from('call_sessions')
    .insert({
      thread_id: threadId,
      caller_id: callerId,
      callee_id: calleeId,
      provider: 'agora',
      rtc_channel: `call-${threadId}-${Date.now()}`,
      status: 'ringing',
    })
    .select('id')
    .single();

  if (callSession.error || !callSession.data?.id) {
    fail(`create call session failed: ${callSession.error?.message || 'missing session id'}`);
  }

  const tokenResult = await callerClient.functions.invoke('create-call-token', {
    body: { sessionId: callSession.data.id },
  });
  if (tokenResult.error || !tokenResult.data) {
    fail(`create-call-token invoke failed: ${tokenResult.error?.message || 'no data'}`);
  }

  const data = tokenResult.data;
  const ok =
    data.success === true &&
    typeof data.channel === 'string' &&
    data.channel.length > 0 &&
    typeof data.token === 'string' &&
    data.token.length > 20 &&
    (!expectedAgoraAppId || data.appId === expectedAgoraAppId);

  if (!ok) {
    console.error('[verify-call-token-flow] Unexpected response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('[verify-call-token-flow] PASS');
  console.log(`[verify-call-token-flow] appId=${data.appId}`);
  console.log(`[verify-call-token-flow] channel=${data.channel}`);
}

try {
  await run();
} finally {
  await cleanup();
}

