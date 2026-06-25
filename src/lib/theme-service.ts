// Theme service — single source of truth for the Light / Dark / System toggle.
// Boot-time application lives in index.html (inline script, runs before React
// to prevent FOUC). This module exposes runtime get/set + a System-watcher.

export type ThemePref = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'theme'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* localStorage unavailable */ }
  return 'dark'
}

// Resolve the pref to the actual applied theme. 'system' follows the OS.
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

export function applyTheme(pref: ThemePref): void {
  const resolved = resolveTheme(pref)
  if (resolved === 'dark') document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
}

export function setThemePref(pref: ThemePref): void {
  try { localStorage.setItem(STORAGE_KEY, pref) } catch { /* ignore */ }
  applyTheme(pref)
}

// Subscribe to OS theme changes — only relevant when pref === 'system'.
// Returns an unsubscribe fn. The caller is responsible for re-checking the
// current pref before reapplying (so an explicit Light or Dark choice isn't
// overridden by an OS swap).
export function subscribeToSystemTheme(handler: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const fn = () => handler()
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
