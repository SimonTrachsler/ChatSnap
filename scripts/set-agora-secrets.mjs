#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function readArg(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return null;
  return hit.slice(prefix.length).trim();
}

function runSupabaseSecretsSet(pairs) {
  const args = ['secrets', 'set', ...pairs];
  const result = spawnSync('supabase', args, { stdio: 'inherit', shell: true });
  if (result.error) {
    console.error('[set-agora-secrets] Failed to run supabase CLI:', result.error.message);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

const appId = readArg('--app-id') || process.env.AGORA_APP_ID || '';
const appCertificate = readArg('--app-cert') || process.env.AGORA_APP_CERTIFICATE || '';
const ttl = readArg('--ttl') || process.env.AGORA_TOKEN_TTL_SECONDS || '3600';

if (!appId) {
  console.error('[set-agora-secrets] Missing AGORA_APP_ID.');
  console.error('Usage:');
  console.error('  AGORA_APP_ID=xxx AGORA_APP_CERTIFICATE=yyy node scripts/set-agora-secrets.mjs');
  console.error('or');
  console.error('  node scripts/set-agora-secrets.mjs --app-id=xxx --app-cert=yyy --ttl=3600');
  process.exit(1);
}

const pairs = [`AGORA_APP_ID=${appId}`, `AGORA_TOKEN_TTL_SECONDS=${ttl}`];
if (appCertificate) {
  pairs.push(`AGORA_APP_CERTIFICATE=${appCertificate}`);
} else {
  console.warn('[set-agora-secrets] AGORA_APP_CERTIFICATE not provided: debug-mode only.');
}

runSupabaseSecretsSet(pairs);

