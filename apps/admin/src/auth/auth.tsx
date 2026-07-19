import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import type { User } from '@pothole/shared';
import { DEV_BYPASS, configureApiAuth, errorMessage, getMe } from '../api/client';

export interface AuthIdentity {
  name: string;
  email: string;
  picture: string | null;
}

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  identity: AuthIdentity | null;
  devMode: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AppAuthProvider');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Dev bypass provider (no Auth0 tenant configured)                    */
/* ------------------------------------------------------------------ */

function DevAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading: false,
      isAuthenticated: true,
      identity: {
        name: 'Dev Admin',
        email: import.meta.env.VITE_DEV_EMAIL || 'admin@dev.local',
        picture: null,
      },
      devMode: true,
      login: () => undefined,
      logout: () => window.location.reload(),
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Auth0 provider                                                      */
/* ------------------------------------------------------------------ */

function Auth0Bridge({ children }: { children: ReactNode }) {
  const {
    isLoading,
    isAuthenticated,
    user,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  useEffect(() => {
    configureApiAuth(async () => {
      try {
        return await getAccessTokenSilently();
      } catch {
        return null;
      }
    });
  }, [getAccessTokenSilently]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isAuthenticated,
      identity: user
        ? {
            name: user.name || user.email || 'Admin',
            email: user.email || '',
            picture: user.picture || null,
          }
        : null,
      devMode: false,
      login: () => void loginWithRedirect(),
      logout: () => void auth0Logout({ logoutParams: { returnTo: window.location.origin } }),
    }),
    [isLoading, isAuthenticated, user, loginWithRedirect, auth0Logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (DEV_BYPASS) {
    return <DevAuthProvider>{children}</DevAuthProvider>;
  }
  const domain = import.meta.env.VITE_AUTH0_DOMAIN as string;
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE;
  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        ...(audience ? { audience } : {}),
      }}
      cacheLocation="localstorage"
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}

/* ------------------------------------------------------------------ */
/* /me context + admin gate                                            */
/* ------------------------------------------------------------------ */

interface MeContextValue {
  me: User;
  refreshMe: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used inside RequireAdmin');
  return ctx;
}

type MeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: User };

/**
 * Route guard: makes sure the visitor is logged in AND their platform
 * role (from /me) is admin or owner. Renders a "not an admin" screen
 * otherwise.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, identity, login, logout, devMode } = useAuth();
  const [state, setState] = useState<MeState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    setState({ status: 'loading' });
    getMe()
      .then((me) => {
        if (!cancelled) setState({ status: 'ready', me });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, reloadKey]);

  if (isLoading) {
    return <CenteredScreen title="Signing you in…" subtitle="Checking your session" spinner />;
  }

  if (!isAuthenticated) {
    return (
      <CenteredScreen title="PotholeCollect Admin" subtitle="Sign in with your admin account to continue.">
        <button className="btn btn-primary" onClick={login}>
          Sign in
        </button>
      </CenteredScreen>
    );
  }

  if (state.status === 'loading') {
    return <CenteredScreen title="Loading your profile…" spinner />;
  }

  if (state.status === 'error') {
    return (
      <CenteredScreen title="Could not load your profile" subtitle={state.message}>
        <div className="row gap">
          <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
          <button className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </CenteredScreen>
    );
  }

  const me = state.me;
  if (me.role !== 'admin' && me.role !== 'owner') {
    return (
      <CenteredScreen
        title="Not an admin"
        subtitle={`Signed in as ${identity?.email || me.email}, but this account has role "${me.role}". Ask an owner to promote you.`}
      >
        <button className="btn btn-ghost" onClick={logout}>
          {devMode ? 'Reload' : 'Sign out'}
        </button>
      </CenteredScreen>
    );
  }

  return (
    <MeContext.Provider value={{ me, refreshMe: () => setReloadKey((k) => k + 1) }}>
      {children}
    </MeContext.Provider>
  );
}

function CenteredScreen(props: {
  title: string;
  subtitle?: string;
  spinner?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="centered-screen">
      <div className="centered-card">
        <div className="logo-mark">🕳️</div>
        <h1>{props.title}</h1>
        {props.subtitle ? <p className="muted">{props.subtitle}</p> : null}
        {props.spinner ? <div className="spinner" aria-label="Loading" /> : null}
        {props.children}
      </div>
    </div>
  );
}
