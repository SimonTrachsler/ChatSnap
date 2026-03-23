import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type User } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { useAuthStore } from '@/store/useAuthStore';
import { useActiveThreadStore } from '@/store/useActiveThreadStore';

// ---------------------------------------------------------------------------
// Env & Client
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function assertEnv(): void {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase env fehlt: EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY in .env setzen (siehe .env.example).'
    );
  }

  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    console.error(
      `[supabase] URL ungueltig – erwartet https://<project>.supabase.co, erhalten: "${supabaseUrl.slice(0, 40)}…"`,
    );
  }

  if (!supabaseAnonKey.startsWith('eyJ')) {
    console.error(
      '[supabase] Anon-Key sieht nicht wie ein JWT aus (erwartet "eyJ…"). ' +
        'Bitte den "anon public" Key aus dem Supabase-Dashboard verwenden (Project Settings → API).',
    );
  }

  if (__DEV__) {
    console.log('[supabase] URL present:', !!supabaseUrl);
    console.log('[supabase] Key format:', supabaseAnonKey.startsWith('eyJ') ? 'valid JWT' : 'INVALID');
  }
}

assertEnv();

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export type SupabaseQueryError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  name?: string;
  context?: {
    json?: () => Promise<unknown>;
  };
};

type MutationResult = Promise<{ error: SupabaseQueryError | null }>;
type SingleResult<T> = Promise<{ data: T | null; error: SupabaseQueryError | null }>;
const INVALID_SESSION_LOG_COOLDOWN_MS = 20_000;
let invalidSessionRecoveryInProgress = false;
let lastInvalidSessionLogAt = 0;

export function callRpc<TResult>(
  fn: string,
  args?: Record<string, unknown>
): Promise<{ data: TResult | null; error: SupabaseQueryError | null }> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: TResult | null; error: SupabaseQueryError | null }>;
  return rpc(fn, args);
}

export function getInsertClient<TInsert>(table: string): {
  insert: (values: TInsert) => MutationResult;
} {
  return supabase.from(table as never) as unknown as {
    insert: (values: TInsert) => MutationResult;
  };
}

export function getInsertSelectSingleClient<TInsert, TResult>(table: string): {
  insert: (values: TInsert) => {
    select: (columns: string) => {
      single: () => SingleResult<TResult>;
    };
  };
} {
  return supabase.from(table as never) as unknown as {
    insert: (values: TInsert) => {
      select: (columns: string) => {
        single: () => SingleResult<TResult>;
      };
    };
  };
}

export function getUpdateClient<TUpdate>(table: string): {
  update: (values: TUpdate) => {
    eq: (column: string, value: string) => MutationResult;
  };
} {
  return supabase.from(table as never) as unknown as {
    update: (values: TUpdate) => {
      eq: (column: string, value: string) => MutationResult;
    };
  };
}

export function getUpsertClient<TInsert>(table: string): {
  upsert: (
    values: TInsert,
    options?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
      count?: 'exact' | 'planned' | 'estimated';
      defaultToNull?: boolean;
    }
  ) => MutationResult;
} {
  return supabase.from(table as never) as unknown as {
    upsert: (
      values: TInsert,
      options?: {
        onConflict?: string;
        ignoreDuplicates?: boolean;
        count?: 'exact' | 'planned' | 'estimated';
        defaultToNull?: boolean;
      }
    ) => MutationResult;
  };
}

// ---------------------------------------------------------------------------
// Network error helper
// ---------------------------------------------------------------------------

function isNetworkError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  const name = String((error as { name?: string })?.name ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('fetch failed') ||
    name.includes('authretryablefetcherror')
  );
}

/**
 * Maps raw Supabase / fetch errors into user-friendly English messages.
 * Screens can call this as a last-resort formatter in their catch blocks.
 */
export function formatNetworkError(error: unknown): string {
  if (isNetworkError(error)) {
    return 'Network connection failed. Please check your internet connection and try again.';
  }
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  const raw = (error as { message?: string })?.message;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'An unexpected error occurred.';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the error indicates an invalid/expired refresh token. */
function isInvalidRefreshTokenError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  const code = (error as { code?: string })?.code ?? '';
  return (
    msg.includes('refresh token') ||
    msg.includes('refresh_token') ||
    code === 'invalid_refresh_token' ||
    code === 'refresh_token_not_found'
  );
}

async function cleanupRealtimeAndThreadState(): Promise<void> {
  useActiveThreadStore.getState().setActiveThreadId(null);
  try {
    await supabase.removeAllChannels();
  } catch {
    // ignore channel cleanup failures
  }
}

/**
 * Handles auth session errors (e.g. Invalid Refresh Token). If the error is due to
 * an invalid/expired refresh token: signs out, clears store, sets sessionExpired,
 * logs once, returns true. Otherwise returns false.
 */
export async function handleAuthSessionError(error: unknown): Promise<boolean> {
  if (!isInvalidRefreshTokenError(error)) return false;
  if (invalidSessionRecoveryInProgress) return true;

  invalidSessionRecoveryInProgress = true;
  try {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // ignore signOut errors
    } finally {
      useAuthStore.getState().setAuth(null);
    }
    await cleanupRealtimeAndThreadState();
    useAuthStore.getState().setSessionExpired(true);
    if (__DEV__) {
      const now = Date.now();
      if (now - lastInvalidSessionLogAt >= INVALID_SESSION_LOG_COOLDOWN_MS) {
        lastInvalidSessionLogAt = now;
        console.warn('[auth] Invalid refresh token detected. Cleared local session.');
      }
    }
    return true;
  } finally {
    invalidSessionRecoveryInProgress = false;
  }
}

/**
 * Liefert den aktuell eingeloggten User oder null.
 * Wirft bei Fehlern beim Session-Abruf (Netzwerk, Invalid Session, etc.).
 * Bei Invalid Refresh Token wird handleAuthSessionError aufgerufen und null zurückgegeben (kein Throw).
 */
export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    const handled = await handleAuthSessionError(error);
    if (handled) return null;
    throw new Error(`getCurrentUser failed: ${error.message}`);
  }
  return user ?? null;
}

/**
 * Liefert den aktuell eingeloggten User.
 * Wirft, wenn kein User eingeloggt ist oder ein Fehler auftritt.
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('requireAuth: Kein User eingeloggt.');
  }
  return user;
}

/**
 * Lädt das Profil aus public.profiles für die gegebene User-ID (auth user id).
 * Gibt null zurück, wenn keine Zeile existiert oder ein Fehler auftritt.
 */
export async function fetchProfileForUser(userId: string): Promise<Database['public']['Tables']['profiles']['Row'] | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, email, avatar_url, bio, onboarding_completed, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) return null;
  return data;
}

/**
 * Stellt sicher, dass ein Profil für den User existiert (Fallback für Bestandsuser / andere Clients).
 * Wird nach Login/Session-Load aufgerufen; der DB-Trigger legt neue User automatisch an.
 */
export function ensureProfileForUser(user: User): void {
  const id = user?.id;
  const email = user?.email ?? null;
  if (!id) return;

  const profilesUpsertClient = getUpsertClient<Database['public']['Tables']['profiles']['Insert']>('profiles');
  profilesUpsertClient.upsert({ id, email }, { onConflict: 'id' }).then(() => {});
}

// ---------------------------------------------------------------------------
// Login: E-Mail zu Benutzername ermitteln (RPC)
// ---------------------------------------------------------------------------

/**
 * Ermittelt die E-Mail zu einem Benutzernamen (für Login).
 * Gibt null zurück, wenn kein Profil mit dem Username existiert.
 */
export async function getEmailByUsername(username: string): Promise<string | null> {
  const trimmed = username.trim();
  if (!trimmed) return null;

  const { data, error } = await callRpc<string>('profiles_get_email_by_username', {
    search_username: trimmed,
  });

  if (error) {
    console.error('[auth] profiles_get_email_by_username failed', {
      username: trimmed,
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    return null;
  }

  const result: unknown = data;
  // PostgREST kann bei returns text einen String oder ein Array zurückgeben
  if (typeof result === 'string' && result.length > 0) return result;
  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    return typeof first === 'string' ? first : (first as { email?: string } | null)?.email ?? null;
  }
  return null;
}

/**
 * Anmeldung mit Benutzername + Passwort.
 * Holt die E-Mail aus public.profiles (username → email), dann signInWithPassword.
 * Wirft "Benutzername nicht gefunden." wenn kein Profil zum Username existiert.
 */
export async function signInWithUsername(username: string, password: string): Promise<void> {
  const trimmed = username.trim();
  if (!trimmed || !password) {
    throw new Error('Enter username and password.');
  }

  const email = await getEmailByUsername(trimmed);
  if (!email) {
    throw new Error('Username not found.');
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Anmeldung mit E-Mail oder Benutzername + Passwort.
 * Enthält die Eingabe ein @, wird sie als E-Mail verwendet (kein profiles-Lookup).
 * Sonst: Benutzername-Lookup über profiles, dann signInWithPassword.
 */
export async function signInWithIdentifier(identifier: string, password: string): Promise<void> {
  const trimmed = identifier.trim();
  if (!trimmed || !password) {
    throw new Error('Enter email or username and password.');
  }

  if (trimmed.includes('@')) {
    const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
    if (error) throw error;
    return;
  }

  await signInWithUsername(trimmed, password);
}

// ---------------------------------------------------------------------------
// Auth gate: on app start validate session; on invalid refresh token sign out and set sessionExpired.
// ---------------------------------------------------------------------------

const SESSION_CHECK_TIMEOUT_MS = 6000;

/**
 * Initializes auth: loads session, validates with server (getUser). On invalid
 * refresh token: handleAuthSessionError (sign out, clear store, set sessionExpired).
 * Subscribes to onAuthStateChange for subsequent changes.
 */
export function initAuthListener(): () => void {
  const { setAuth, setLoading } = useAuthStore.getState();

  setLoading(true);
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    setLoading(false);
  };

  const timeoutId = setTimeout(() => {
    if (settled) return;
    clearTimeout(timeoutId);
    settle();
    setAuth(null);
  }, SESSION_CHECK_TIMEOUT_MS);

  supabase.auth
    .getSession()
    .then(async ({ data: { session } }) => {
      if (settled) return;
      if (!session) {
        clearTimeout(timeoutId);
        setAuth(null);
        settle();
        return;
      }
      // Validate with server so invalid refresh token fails here
      const { data: { user }, error } = await supabase.auth.getUser();
      if (settled) return;
      clearTimeout(timeoutId);
      if (error) {
        const handled = await handleAuthSessionError(error);
        if (handled) setAuth(null);
        else setAuth(null);
        settle();
        return;
      }
      setAuth(session);
      if (user) ensureProfileForUser(user);
      settle();
    })
    .catch(async (err) => {
      if (!settled) clearTimeout(timeoutId);
      if (isNetworkError(err)) {
        if (__DEV__) console.warn('[auth-init] Network error during session check – skipping.');
        setAuth(null);
        settle();
        return;
      }
      const handled = await handleAuthSessionError(err);
      if (!handled) setAuth(null);
      settle();
    })
    .finally(() => {
      if (!settled) settle();
    });

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    setAuth(session);
    if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
      ensureProfileForUser(session.user);
    }
  });

  return () => {
    clearTimeout(timeoutId);
    subscription.unsubscribe();
  };
}
