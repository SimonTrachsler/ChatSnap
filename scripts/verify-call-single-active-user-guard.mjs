#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

function env(name) {
  return (process.env[name] || '').trim();
}

function fail(message) {
  console.error(`[verify-call-single-active-user-guard] ${message}`);
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
let userCId = null;

async function cleanup() {
  if (userAId) await admin.auth.admin.deleteUser(userAId);
  if (userBId) await admin.auth.admin.deleteUser(userBId);
  if (userCId) await admin.auth.admin.deleteUser(userCId);
}

async function run() {
  const password = `TempPass!${Math.floor(Math.random() * 1_000_000)}`;
  const emailA = `active_guard_a_${Date.now()}_${rand()}@example.com`;
  const emailB = `active_guard_b_${Date.now()}_${rand()}@example.com`;
  const emailC = `active_guard_c_${Date.now()}_${rand()}@example.com`;

  const createA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (createA.error || !createA.data.user) fail(`create user A failed: ${createA.error?.message || 'unknown'}`);
  userAId = createA.data.user.id;

  const createB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (createB.error || !createB.data.user) fail(`create user B failed: ${createB.error?.message || 'unknown'}`);
  userBId = createB.data.user.id;

  const createC = await admin.auth.admin.createUser({ email: emailC, password, email_confirm: true });
  if (createC.error || !createC.data.user) fail(`create user C failed: ${createC.error?.message || 'unknown'}`);
  userCId = createC.data.user.id;

  await admin.from('profiles').update({ username: `active_a_${rand(6)}` }).eq('id', userAId);
  await admin.from('profiles').update({ username: `active_b_${rand(6)}` }).eq('id', userBId);
  await admin.from('profiles').update({ username: `active_c_${rand(6)}` }).eq('id', userCId);

  const insFriends = await admin.from('friends').insert([
    { user_id: userAId, friend_id: userBId },
    { user_id: userBId, friend_id: userAId },
    { user_id: userAId, friend_id: userCId },
    { user_id: userCId, friend_id: userAId },
  ]);
  if (insFriends.error) fail(`insert friends failed: ${insFriends.error.message}`);

  const signInA = await anonClient.auth.signInWithPassword({ email: emailA, password });
  if (signInA.error || !signInA.data.session) {
    fail(`user A sign in failed: ${signInA.error?.message || 'no session'}`);
  }

  const userAClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${signInA.data.session.access_token}` } },
  });

  const threadAB = await userAClient.rpc('get_or_create_thread', { other_user_id: userBId });
  if (threadAB.error || !threadAB.data) {
    fail(`thread AB failed: ${threadAB.error?.message || 'no thread id'}`);
  }

  const threadAC = await userAClient.rpc('get_or_create_thread', { other_user_id: userCId });
  if (threadAC.error || !threadAC.data) {
    fail(`thread AC failed: ${threadAC.error?.message || 'no thread id'}`);
  }

  const firstCall = await userAClient
    .from('call_sessions')
    .insert({
      thread_id: threadAB.data,
      caller_id: userAId,
      callee_id: userBId,
      provider: 'agora',
      rtc_channel: `guard-ab-${Date.now()}`,
      status: 'ringing',
    })
    .select('id')
    .single();
  if (firstCall.error || !firstCall.data?.id) {
    fail(`first call insert failed: ${firstCall.error?.message || 'missing id'}`);
  }

  const secondCall = await userAClient
    .from('call_sessions')
    .insert({
      thread_id: threadAC.data,
      caller_id: userAId,
      callee_id: userCId,
      provider: 'agora',
      rtc_channel: `guard-ac-${Date.now()}`,
      status: 'ringing',
    })
    .select('id')
    .single();

  if (!secondCall.error) {
    fail('Guard failed: user A was able to start a second active call.');
  }

  if (!secondCall.error.message.toLowerCase().includes('already in an active call')) {
    fail(`Unexpected guard error message: ${secondCall.error.message}`);
  }

  console.log('[verify-call-single-active-user-guard] PASS');
  console.log(`[verify-call-single-active-user-guard] blocked second call: ${secondCall.error.message}`);
}

try {
  await run();
} finally {
  await cleanup();
}
