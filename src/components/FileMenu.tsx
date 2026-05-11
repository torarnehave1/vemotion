import React, { useRef, useState } from 'react';
import { ChevronDown, FilePlus, Save, Upload, FolderOpen, Trash2, Loader2 } from 'lucide-react';
import type { CompositionData } from '../lib/api';

interface SavedComposition {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface FileMenuProps {
  composition: CompositionData;
  userEmail?: string;
  onLoad: (c: CompositionData) => void;
  onNew: () => void;
}


export const FileMenu: React.FC<FileMenuProps> = ({ composition, userEmail, onLoad, onNew }) => {
  const [open, setOpen] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudList, setCloudList] = useState<SavedComposition[]>([]);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const close = () => { setOpen(false); setShowCloud(false); setError(''); };

  // ── Computer ────────────────────────────────────────────────────────────────

  const saveToComputer = () => {
    const json = JSON.stringify(composition, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vemotion-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    close();
  };

  const loadFromComputer = () => {
    fileInputRef.current?.click();
    close();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        onLoad(parsed);
        setCurrentId(null);
      } catch {
        alert('Invalid composition file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Cloud ───────────────────────────────────────────────────────────────────

  const openCloud = async () => {
    if (!userEmail) { setError('Sign in to use cloud save.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/compositions?email=${encodeURIComponent(userEmail)}`);
      const data = await res.json();
      setCloudList(data.compositions ?? []);
      setShowCloud(true);
    } catch {
      setError('Failed to load compositions from cloud.');
    } finally {
      setLoading(false);
    }
  };

  const saveToCloud = async () => {
    if (!userEmail) { setError('Sign in to use cloud save.'); return; }
    const name = saveName.trim() || `Composition ${new Date().toLocaleDateString()}`;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId, email: userEmail, name, composition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrentId(data.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const loadFromCloud = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/compositions/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onLoad(data.composition);
      setCurrentId(data.id);
      setSaveName(data.name);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  const deleteFromCloud = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this composition?')) return;
    await fetch(`/api/compositions/${id}`, { method: 'DELETE' });
    setCloudList(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg border border-slate-700 transition"
        onClick={() => { setOpen(o => !o); setShowCloud(false); setError(''); }}
      >
        File <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">

            {!showCloud ? (
              <>
                <MenuItem icon={<FilePlus className="w-4 h-4" />} label="New composition" onClick={() => { onNew(); close(); }} />
                <div className="h-px bg-slate-800 mx-3" />
                <MenuItem icon={<Save className="w-4 h-4" />} label="Save to computer" onClick={saveToComputer} />
                <MenuItem icon={<Upload className="w-4 h-4" />} label="Load from computer" onClick={loadFromComputer} />
                <div className="h-px bg-slate-800 mx-3" />
                <MenuItem icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />} label="Open from cloud" onClick={openCloud} />
                <div className="p-3 border-t border-slate-800 space-y-2">
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    placeholder="Composition name…"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                  />
                  <button
                    className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg py-1.5 transition"
                    onClick={saveToCloud}
                    disabled={saving || !userEmail}
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {currentId ? 'Update in cloud' : 'Save to cloud'}
                  </button>
                  {error && <p className="text-red-400 text-xs">{error}</p>}
                  {!userEmail && <p className="text-slate-500 text-xs">Sign in to save to cloud</p>}
                </div>
              </>
            ) : (
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-300">Saved compositions</span>
                  <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setShowCloud(false)}>Back</button>
                </div>
                {cloudList.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-4">No saved compositions yet.</p>
                ) : (
                  cloudList.map(c => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer group"
                      onClick={() => loadFromCloud(c.id)}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200 truncate">{c.name}</p>
                        <p className="text-xs text-slate-500">{new Date(c.updated_at * 1000).toLocaleDateString()}</p>
                      </div>
                      <button
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                        onClick={e => deleteFromCloud(c.id, e)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
                {error && <p className="text-red-400 text-xs">{error}</p>}
              </div>
            )}
          </div>
        </>
      )}

      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
    </div>
  );
};

const MenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
  <button
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition text-left"
    onClick={onClick}
  >
    <span className="text-slate-400">{icon}</span>
    {label}
  </button>
);
