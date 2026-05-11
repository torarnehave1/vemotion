export type AuthUser = {
  userId: string;
  email: string;
  role?: string | null;
  emailVerificationToken?: string | null;
  displayName?: string | null;
};

// Development mode enabled by URL param (?dev=true) or env
export const DEV_MODE =
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dev') === 'true') ||
  import.meta.env.VITE_DEV_MODE === 'true';

const MOCK_USER: AuthUser = {
  userId: 'dev_user_12345',
  email: 'dev@vegvisr.local',
  displayName: 'Dev User',
  role: 'admin',
};

export const readStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = parsed.user_id || parsed.oauth_id;
    const email = parsed.email;
    if (!userId || !email) return null;
    return {
      userId,
      email,
      role: parsed.role || null,
      emailVerificationToken: parsed.emailVerificationToken || null,
      displayName: parsed.displayName || parsed.display_name || null,
    };
  } catch {
    return null;
  }
};

export const setMockUser = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('user', JSON.stringify({
    user_id: MOCK_USER.userId,
    email: MOCK_USER.email,
    display_name: MOCK_USER.displayName,
    role: MOCK_USER.role,
  }));
};

export const clearStoredUser = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('user');
  }
};
