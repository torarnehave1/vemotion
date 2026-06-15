import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { AuthBar, EcosystemNav } from 'vegvisr-ui-kit';
import { readStoredUser, type AuthUser } from './lib/auth';
import ImpersonationBar from './components/ImpersonationBar';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { EmbedView } from './components/EmbedView';

const MAGIC_BASE = 'https://cookie.vegvisr.org';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

const AuthContext = createContext<AuthUser | null>(null);
export const useAuth = () => useContext(AuthContext);

function App() {
  // Embed mode: when `?embed=1` is present, render only the player and bypass
  // all editor chrome (AuthBar, EcosystemNav, Login, Dashboard, FileMenu, etc).
  // The frame-ancestors CSP in public/_headers allows iframing from
  // *.vegvisr.org subdomains (e.g. agent.vegvisr.org).
  const isEmbed = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('embed') === '1';
  }, []);

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');

  const setAuthCookie = (token: string) => {
    if (!token) return;
    const isVegvisr = window.location.hostname.endsWith('vegvisr.org');
    const domain = isVegvisr ? '; Domain=.vegvisr.org' : '';
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `vegvisr_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`;
  };

  const persistUser = (user: {
    email: string;
    role: string;
    user_id: string | null;
    emailVerificationToken: string | null;
    oauth_id?: string | null;
    displayName?: string | null;
  }) => {
    const payload = {
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      oauth_id: user.oauth_id || user.user_id || null,
      emailVerificationToken: user.emailVerificationToken,
      displayName: user.displayName || null,
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) setAuthCookie(user.emailVerificationToken);
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({
      userId: payload.user_id || payload.oauth_id || '',
      email: payload.email,
      role: payload.role || null,
      displayName: payload.displayName,
    });
  };

  const fetchUserContext = async (targetEmail: string) => {
    const roleRes = await fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(targetEmail)}`);
    if (!roleRes.ok) throw new Error(`User role unavailable (status: ${roleRes.status})`);
    const roleData = await roleRes.json();
    if (!roleData?.role) throw new Error('Unable to retrieve user role.');
    const userDataRes = await fetch(`${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(targetEmail)}`);
    if (!userDataRes.ok) throw new Error(`Unable to fetch user data (status: ${userDataRes.status})`);
    const userData = await userDataRes.json();
    return {
      email: targetEmail,
      role: roleData.role,
      user_id: userData.user_id,
      emailVerificationToken: userData.emailVerificationToken,
      oauth_id: userData.oauth_id,
    };
  };

  const verifyMagicToken = async (token: string) => {
    const res = await fetch(`${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.success || !data.email) throw new Error(data.error || 'Invalid or expired magic link.');
    try {
      const userContext = await fetchUserContext(data.email);
      persistUser(userContext);
    } catch {
      try {
        await fetch(`${DASHBOARD_BASE}/register-realtime-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });
        const userContext = await fetchUserContext(data.email);
        persistUser(userContext);
      } catch {
        persistUser({ email: data.email, role: 'user', user_id: data.email, emailVerificationToken: null });
      }
    }
  };

  const clearAuthCookie = () => {
    const base = 'vegvisr_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    document.cookie = base;
    if (window.location.hostname.endsWith('vegvisr.org')) {
      document.cookie = `${base}; Domain=.vegvisr.org`;
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('user');
      sessionStorage.removeItem('email_session_verified');
    } catch { /* ignore */ }
    clearAuthCookie();
    setAuthUser(null);
    setAuthStatus('anonymous');
  };

  // Handle magic link token in URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    setAuthStatus('checking');
    verifyMagicToken(magic)
      .then(() => {
        url.searchParams.delete('magic');
        window.history.replaceState({}, '', url.toString());
        setAuthStatus('authed');
      })
      .catch(() => setAuthStatus('anonymous'));
  }, []);

  // Validate stored user on load
  useEffect(() => {
    let isMounted = true;
    const stored = readStoredUser();
    if (stored?.email) {
      fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(stored.email)}`)
        .then(async res => {
          if (!isMounted) return;
          if (res.ok) {
            const roleData = await res.json().catch(() => null);
            const nextRole = typeof roleData?.role === 'string' ? roleData.role : stored.role || null;
            try {
              localStorage.setItem('user', JSON.stringify({
                ...JSON.parse(localStorage.getItem('user') || '{}'),
                role: nextRole,
              }));
            } catch { /* ignore */ }
            setAuthUser({ ...stored, role: nextRole });
            setAuthStatus('authed');
          } else {
            try { localStorage.removeItem('user'); } catch { /* ignore */ }
            setAuthUser(null);
            setAuthStatus('anonymous');
          }
        })
        .catch(() => {
          if (!isMounted) return;
          setAuthUser(stored);
          setAuthStatus('authed');
        });
    } else if (isMounted) {
      setAuthStatus('anonymous');
    }
    return () => { isMounted = false; };
  }, []);

  // Embed mode short-circuits the auth flow — no Login screen, no AuthBar,
  // no EcosystemNav. The composition fetch inside EmbedView uses whatever
  // X-API-Token is in localStorage today; if absent, EmbedView surfaces a
  // load error instead of redirecting to a login page.
  if (isEmbed) {
    return <EmbedView />;
  }

  if (authStatus === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="animate-pulse text-slate-400">Loading…</div>
      </div>
    );
  }

  if (authStatus === 'anonymous') {
    return <Login />;
  }

  return (
    <AuthContext.Provider value={authUser}>
      <div className="min-h-screen bg-slate-950 flex flex-col">
        <AuthBar
          userEmail={authUser?.email}
          badgeLabel="Vemotion"
          signInLabel="Sign in"
          logoutLabel="Log out"
          onLogout={handleLogout}
        />
        <EcosystemNav />
        {/* System Owner "Login as…" control + impersonation banner.
            Renders nothing for non-owners (403 from /admin/users). */}
        <ImpersonationBar />
        <main className="flex-1 flex flex-col">
          <Dashboard />
        </main>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
