import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, Check } from 'lucide-react';
import { listInstagramAccounts, type BlotatoAccount, type AccountPostResult } from '../lib/blotato';

/**
 * Shared Instagram account state for the post modals. Both PostCarouselModal
 * and PostVideoModal had an identical fetch-and-default effect; this is the one
 * copy (Lesson 22 — reuse before rebuilding).
 *
 * Selection is a SET of ids: the same media can be published to several
 * connected handles in one go. Defaults to `tor.arne.have` (else the first
 * account) so the common single-account flow needs no extra click.
 */
export function useInstagramAccounts() {
  const [accounts, setAccounts] = useState<BlotatoAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listInstagramAccounts()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        const preferred = list.find((a) => a.username === 'tor.arne.have') ?? list[0];
        if (preferred) setSelectedIds([preferred.id]);
      })
      .catch((e) => { if (!cancelled) setAccountsError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Kept in the connected-accounts order so the publish loop is predictable.
  const selectedAccounts = (accounts ?? [])
    .filter((a) => selectedIds.includes(a.id))
    .map((a) => ({ id: a.id, username: a.username }));

  return { accounts, accountsError, selectedIds, toggle, selectedAccounts };
}

interface PickerProps {
  accounts: BlotatoAccount[] | null;
  error: string | null;
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}

/**
 * Multi-select list of the connected Instagram accounts. A checkbox row per
 * handle — every checked account gets its own post of the same media.
 */
export const InstagramAccountPicker: React.FC<PickerProps> = ({ accounts, error, selectedIds, onToggle, disabled }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <label className="text-xs text-slate-500 dark:text-slate-400">Instagram accounts</label>
      {selectedIds.length > 0 && (
        <span className="text-[10px] text-slate-400">{selectedIds.length} selected</span>
      )}
    </div>
    {error ? (
      <p className="text-xs text-red-400">{error}</p>
    ) : accounts === null ? (
      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…</div>
    ) : accounts.length === 0 ? (
      <p className="text-xs text-amber-500">No Instagram account is connected in Blotato.</p>
    ) : (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {accounts.map((a) => {
          const checked = selectedIds.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onToggle(a.id)}
              disabled={disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
                checked ? 'bg-sky-50 dark:bg-sky-500/10' : 'bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${
                checked ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {checked && <Check className="w-3 h-3" />}
              </span>
              <span className="text-slate-900 dark:text-slate-200 truncate">@{a.username}</span>
              {a.fullname && <span className="text-xs text-slate-400 truncate">{a.fullname}</span>}
            </button>
          );
        })}
      </div>
    )}
  </div>
);

/**
 * Per-account outcome of a multi-account publish. Every account gets a row —
 * a partial success reads as a partial success, not as a blanket "published".
 */
export const PostResultList: React.FC<{ results: AccountPostResult[]; pendingNote: string }> = ({ results, pendingNote }) => {
  const okCount = results.filter((r) => r.ok).length;
  return (
    <div className="space-y-3">
      <p className={`text-sm font-medium ${okCount === results.length ? 'text-emerald-500' : 'text-amber-500'}`}>
        Published to {okCount} of {results.length} account{results.length === 1 ? '' : 's'}.
      </p>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.accountId} className="text-xs">
            <span className={r.ok ? 'text-slate-700 dark:text-slate-300' : 'text-red-400'}>@{r.username ?? r.accountId}</span>
            {r.ok ? (
              r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-sky-500 hover:text-sky-400 underline">
                  View <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="ml-2 text-slate-500">{pendingNote}</span>
              )
            ) : (
              <span className="ml-2 text-red-400 break-words">{r.error}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
