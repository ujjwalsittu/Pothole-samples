/**
 * Auth state for the app: wraps react-native-auth0's provider and layers the
 * PotholeCollect profile (GET /me) on top. The Auth0 access token is stored
 * in expo-secure-store and injected by src/api/client.ts.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';
import { CONFIG } from '@/config';
import { ApiError, getStoredToken, setStoredToken } from '@/api/client';
import { getMe, type MeResponse } from '@/api/endpoints';

/** Where the app should send the user, derived from token + profile state. */
export type AuthStatus =
  | 'loading'
  | 'signedOut'
  | 'noProfile' // authenticated with Auth0 but /me has no completed signup
  | 'pending' // profile exists, awaiting admin approval
  | 'rejected'
  | 'suspended'
  | 'approved';

export interface AuthState {
  status: AuthStatus;
  profile: MeResponse | null;
  /** Last auth/profile error message, for display on login screen. */
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithUniversal: () => Promise<void>;
  refreshProfile: () => Promise<AuthStatus>;
  setProfile: (u: MeResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

function statusFromProfile(profile: MeResponse): AuthStatus {
  switch (profile.accountState) {
    case 'approved':
      return 'approved';
    case 'pending_approval':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'suspended':
      return 'suspended';
    default:
      return 'pending';
  }
}

function InnerAuthProvider({ children }: { children: React.ReactNode }) {
  const { authorize, clearSession } = useAuth0();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfileState] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async (): Promise<AuthStatus> => {
    const token = await getStoredToken();
    if (!token) {
      setProfileState(null);
      setStatus('signedOut');
      return 'signedOut';
    }
    try {
      const me = await getMe();
      setProfileState(me);
      const s = statusFromProfile(me);
      setStatus(s);
      return s;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'PROFILE_NOT_FOUND' || e.status === 404) {
          setProfileState(null);
          setStatus('noProfile');
          return 'noProfile';
        }
        if (e.status === 401) {
          await setStoredToken(null);
          setProfileState(null);
          setStatus('signedOut');
          return 'signedOut';
        }
        setError(e.message);
      } else {
        setError('Could not reach the server.');
      }
      // Keep previous status on transient errors; if we had none, stay signedOut-ish.
      const fallback: AuthStatus = profile ? statusFromProfile(profile) : 'signedOut';
      setStatus(fallback);
      return fallback;
    }
  }, [profile]);

  useEffect(() => {
    // Initial boot: resolve status from the stored token.
    void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doAuthorize = useCallback(
    async (connection?: string) => {
      setError(null);
      try {
        const credentials = await authorize({
          audience: CONFIG.auth0Audience,
          scope: 'openid profile email offline_access',
          ...(connection ? { connection } : {}),
        });
        if (!credentials?.accessToken) {
          setError('Login was cancelled.');
          return;
        }
        await setStoredToken(credentials.accessToken);
        await refreshProfile();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed.');
      }
    },
    [authorize, refreshProfile],
  );

  const loginWithGoogle = useCallback(() => doAuthorize('google-oauth2'), [doAuthorize]);
  const loginWithUniversal = useCallback(() => doAuthorize(), [doAuthorize]);

  const logout = useCallback(async () => {
    try {
      await clearSession();
    } catch {
      // Session clearing can fail if the browser was dismissed; still log out locally.
    }
    await setStoredToken(null);
    setProfileState(null);
    setStatus('signedOut');
  }, [clearSession]);

  const setProfile = useCallback((u: MeResponse) => {
    setProfileState(u);
    setStatus(statusFromProfile(u));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      profile,
      error,
      loginWithGoogle,
      loginWithUniversal,
      refreshProfile,
      setProfile,
      logout,
    }),
    [status, profile, error, loginWithGoogle, loginWithUniversal, refreshProfile, setProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider domain={CONFIG.auth0Domain} clientId={CONFIG.auth0ClientId}>
      <InnerAuthProvider>{children}</InnerAuthProvider>
    </Auth0Provider>
  );
}
