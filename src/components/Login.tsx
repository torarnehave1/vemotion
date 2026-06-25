import React, { useState } from 'react';
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginProps {
  onLoginSuccess?: () => void;
  onDevLogin?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onDevLogin }) => {
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const MAGIC_BASE = 'https://cookie.vegvisr.org';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setError('');
    setIsLoading(true);

    try {
      const redirectUrl = window.location.href;
      const res = await fetch(`${MAGIC_BASE}/login/magic/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), redirectUrl }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to send magic link.');
      }

      setIsSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex justify-center mb-8">
          <img
            src="https://vegvisr.imgix.net/sdxl-1778295825277.jpg"
            alt="Vemotion"
            className="w-20 h-20 rounded-3xl object-cover shadow-lg"
          />
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-2">
          Video Generator
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-center text-sm mb-8">
          Sign in with your Vegvisr account to generate videos
        </p>

        {!isSent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 w-4 h-4" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-sky-800 disabled:cursor-not-allowed text-slate-900 dark:text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 transition"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send magic link'
              )}
            </button>

            {onDevLogin && (
              <button
                type="button"
                onClick={onDevLogin}
                className="w-full mt-3 bg-amber-600 hover:bg-amber-500 text-slate-900 dark:text-white font-semibold rounded-xl py-3 transition text-sm"
              >
                🔨 Dev Login (Local Only)
              </button>
            )}
          </form>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center space-y-4"
          >
            <div className="flex justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
            </div>
            <p className="text-slate-900 dark:text-white font-medium">Check your inbox!</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              We sent a magic link to <span className="text-sky-400">{email}</span>.
              Click the link to sign in.
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
