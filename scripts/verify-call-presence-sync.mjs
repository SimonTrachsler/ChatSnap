#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

function env(name) {
  return (process.env[name] || '').trim();
}

function fail(message) {
  console.error(`[verify-call-presence-sync] ${message}`);
  process.exit(1);
}

function rand(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len);
}

const url = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
const anon = env('EXPO_PUBLIC_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY');

if (!url) fail('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
if (!anon) fail('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY.');
if (!serviceRole) fail('Missing SUPABASE_SERVICE_ROLE_KEY.');

const admin = createClient(url, serviceRole);
const anonClient = createClient(url, anon);

let userAId = null;
let userBId = null;

async function cleanup() {
  if (userAId) await admin.auth.admin.deleteUser(userAId);
  if (userBId) await admin.auth.admin.deleteUser(userBId);
}

async function getPresence(userId) {
  const res = await admin
    .from('call_presence')
    .select('is_in_call')
    .eq('user_id', userId)
    .maybeSingle();
  if (res.error) fail(`presence query failed for ${userId}: ${res.error.message}`);
  return (res.data?.is_in_call ?? false) === true;
}

async function run() {
  const password = `TempPass!${Math.floor(Math.random() * 1_000_000)}`;
  const emailA = `presence_a_${Date.now()}_${rand()}@example.com`;
  const emailB = `presence_b_${Date.now()}_${rand()}@example.com`;

  const createA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (createA.error || !createA.data.user) fail(`create user A failed: ${createA.error?.message || 'unknown'}`);
  userAId = createA.data.user.id;

  const createB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (createB.error || !createB.data.user) fail(`create user B failed: ${createB.error?.message || 'unknown'}`);
  userBId = createB.data.user.id;

  await admin.from('profiles').update({ username: `presence_a_${rand(6)}` }).eq('id', userAId);
  await admin.from('profiles').update({ username: `presence_b_${rand(6)}` }).eq('id', userBId);

  const insFriends = await admin.from('friends').insert([
    { user_id: userAId, friend_id: userBId },
    { user_id: userBId, friend_id: userAId },
  ]);
  if (insFriends.error) fail(`insert friends failed: ${insFriends.error.message}`);

  const signInA = await anonClient.auth.signInWithPassword({ email: emailA, password });
  if (signInA.error || !signInA.data.session) fail(`user A sign in failed: ${signInA.error?.message || 'no session'}`);
  const userAClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${signInA.data.session.access_token}` } },
  });

  const thread = await userAClient.rpc('get_or_create_thread', { other_user_id: userBId });
  if (thread.error || !thread.data) fail(`get_or_create_thread failed: ${thread.error?.message || 'no thread id'}`);

  const beforeA = await getPresence(userAId);
  const beforeB = await getPresence(userBId);
  if (beforeA || beforeB) {
    fail('Expected both users to be not-in-call before session creation.');
  }

  const callInsert = await userAClient
    .from('call_sessions')
    .insert({
      thread_id: thread.data,
      caller_id: userAId,
      callee_id: userBId,
      provider: 'agora',
      rtc_channel: `presence-${Date.now()}`,
      status: 'ringing',
    })
    .select('id')
    .single();
  if (callInsert.error || !callInsert.data?.id) fail(`call insert failed: ${callInsert.error?.message || 'missing id'}`);

  const activeA = await getPresence(userAId);
  const activeB = await getPresence(userBId);
  if (!activeA || !activeB) {
    fail(`Expected both users busy during ringing call. got A=${activeA} B=${activeB}`);
  }

  const cancelCall = await userAClient
    .from('call_sessions')
    .update({ status: 'cancelled' })
    .eq('id', callInsert.data.id)
    .eq('status', 'ringing');
  if (cancelCall.error) fail(`call cancel failed: ${cancelCall.error.message}`);

  const afterA = await getPresence(userAId);
  const afterB = await getPresence(userBId);
  if (afterA || afterB) {
    fail(`Expected both users not busy after cancel. got A=${afterA} B=${afterB}`);
  }

  console.log('[verify-call-presence-sync] PASS');
}

try {
  await run();
} finally {
  await cleanup();
}
