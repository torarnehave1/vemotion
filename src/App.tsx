import { useState, useEffect, createContext, useContext } from 'react';
import { AuthBar, EcosystemNav } from 'vegvisr-ui-kit';
import { readStoredUser, type AuthUser, setMockUser, DEV_MODE, clearStoredUser } from './lib/auth';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

const AuthContext = createContext<AuthUser | null>(null);

export const useAuth = () => {
  const auth = useContext(AuthContext);
  if (auth === null) return null;
  return auth;
};

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = readStoredUser();
    setUser(stored);
    setIsLoading(false);
  }, []);

  const handleDevLogin = () => {
    setMockUser();
    const stored = readStoredUser();
    setUser(stored);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="animate-pulse text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={user}>
      {!user ? (
        <Login onDevLogin={DEV_MODE ? handleDevLogin : undefined} />
      ) : (
        <div className="min-h-screen bg-slate-950">
          <AuthBar
            user={{ email: user.email, displayName: user.displayName ?? undefined }}
            onLogout={() => {
              clearStoredUser();
              setUser(null);
            }}
          />
          <EcosystemNav />
          <main className="container mx-auto px-4 py-8">
            <Dashboard />
          </main>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export default App;
