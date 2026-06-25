import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme-service';

interface Props {
  onClose: () => void;
}

export const AppearanceModal: React.FC<Props> = ({ onClose }) => {
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref());

  const handleThemeChange = (next: ThemePref) => {
    setTheme(next);
    setThemePref(next);
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <label className="block text-xs text-slate-500 dark:text-white/50 uppercase tracking-wider">
            Appearance
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((opt) => {
              const active = theme === opt;
              const label = opt === 'system' ? 'System' : opt === 'light' ? 'Light' : 'Dark';
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleThemeChange(opt)}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                    active
                      ? 'bg-sky-600 text-slate-900 dark:text-white border-sky-500'
                      : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-white/30">
            System follows your OS preference.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};
