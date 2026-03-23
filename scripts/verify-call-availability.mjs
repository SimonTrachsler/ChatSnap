#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

function env(name) {
  return (process.env[name] || '').trim();
}

function fail(message) {
  console.error(`[verify-call-availability] ${message}`);
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

function expectReason(result, expectedReason, label) {
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const reason = row?.reason ?? null;
  const available = row?.available === true;
  if (reason !== expectedReason) {
    fail(`${label}: expected reason=${expectedReason}, got reason=${String(reason)} available=${String(available)}`);
  }
}

async function run() {
  const password = `TempPass!${Math.floor(Math.random() * 1_000_000)}`;
  const emailA = `availability_a_${Date.now()}_${rand()}@example.com`;
  const emailB = `availability_b_${Date.now()}_${rand()}@example.com`;
  const emailC = `availability_c_${Date.now()}_${rand()}@example.com`;

  const createA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (createA.error || !createA.data.user) fail(`create user A failed: ${createA.error?.message || 'unknown'}`);
  userAId = createA.data.user.id;

  const createB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (createB.error || !createB.data.user) fail(`create user B failed: ${createB.error?.message || 'unknown'}`);
  userBId = createB.data.user.id;

  const createC = await admin.auth.admin.createUser({ email: emailC, password, email_confirm: true });
  if (createC.error || !createC.data.user) fail(`create user C failed: ${createC.error?.message || 'unknown'}`);
  userCId = createC.data.user.id;

  await admin.from('profiles').update({ username: `availability_a_${rand(6)}` }).eq('id', userAId);
  await admin.from('profiles').update({ username: `availability_b_${rand(6)}` }).eq('id', userBId);
  await admin.from('profiles').update({ username: `availability_c_${rand(6)}` }).eq('id', userCId);

  const insFriends = await admin.from('friends').insert([
    { user_id: userAId, friend_id: userBId },
    { user_id: userBId, friend_id: userAId },
    { user_id: userAId, friend_id: userCId },
    { user_id: userCId, friend_id: userAId },
  ]);
  if (insFriends.error) fail(`insert friends failed: ${insFriends.error.message}`);

  const signInA = await anonClient.auth.signInWithPassword({ email: emailA, password });
  if (signInA.error || !signInA.data.session) fail(`user A sign in failed: ${signInA.error?.message || 'no session'}`);
  const signInC = await anonClient.auth.signInWithPassword({ email: emailC, password });
  if (signInC.error || !signInC.data.session) fail(`user C sign in failed: ${signInC.error?.message || 'no session'}`);

  const userAClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${signInA.data.session.access_token}` } },
  });
  const userCClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${signInC.data.session.access_token}` } },
  });

  const availabilityBefore = await userAClient.rpc('get_call_availability', { p_target_user_id: userBId });
  if (availabilityBefore.error) fail(`availability before call failed: ${availabilityBefore.error.message}`);
  expectReason(availabilityBefore, 'available', 'before call');

  const threadAB = await userAClient.rpc('get_or_create_thread', { other_user_id: userBId });
  if (threadAB.error || !threadAB.data) fail(`thread AB failed: ${threadAB.error?.message || 'no thread id'}`);

  const callRes = await userAClient
    .from('call_sessions')
    .insert({
      thread_id: threadAB.data,
      caller_id: userAId,
      callee_id: userBId,
      provider: 'agora',
      rtc_channel: `availability-${Date.now()}`,
      status: 'ringing',
    })
    .select('id')
    .single();
  if (callRes.error || !callRes.data?.id) fail(`call create failed: ${callRes.error?.message || 'missing id'}`);

  const availabilityForA = await userAClient.rpc('get_call_availability', { p_target_user_id: userBId });
  if (availabilityForA.error) fail(`availability for A failed: ${availabilityForA.error.message}`);
  expectReason(availabilityForA, 'already_with_you', 'active pair check');

  const availabilityForC = await userCClient.rpc('get_call_availability', { p_target_user_id: userAId });
  if (availabilityForC.error) fail(`availability for C failed: ${availabilityForC.error.message}`);
  expectReason(availabilityForC, 'target_busy', 'third-party target busy check');

  console.log('[verify-call-availability] PASS');
}

try {
  await run();
} finally {
  await cleanup();
}
