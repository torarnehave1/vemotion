declare module 'vegvisr-ui-kit' {
  import { FC, ReactNode } from 'react';

  export const AuthBar: FC<{
    user: { email: string; displayName?: string };
    onLogout: () => void;
  }>;

  export const EcosystemNav: FC<{ className?: string }>;

  export const Button: FC<any>;
  export const Input: FC<any>;
  export const Card: FC<any>;
}
