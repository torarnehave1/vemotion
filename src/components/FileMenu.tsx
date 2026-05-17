import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FilePlus, Save, Upload, FolderOpen, Trash2, Loader2 } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import { getCompositionFromCloud, saveCompositionToCloud, writeLastCompositionRef } from '../lib/cloud-compositions';
import { movementOverTimeExample, neyLessonExample } from '../lib/examples';

const VEMOTION_API = 'https://api.vegvisr.org/vemotion';

interface SavedComposition {
  id: string;
  name: string;
  updatedAt: string;
  layerCount?: number;
}

interface FileMenuProps {
  composition: CompositionData;
  userEmail?: string;
  currentCloudId?: string | null;
  currentCloudName?: string;
  onLoad: (c: CompositionData) => void;
  onNew: () => void;
  onCloudMetaChange?: (payload: { id: string | null; name: string }) => void;
  onCloudSaved?: (payload: { id: string; name: string; version?: number }) => void;
}


export const FileMenu: React.FC<FileMenuProps> = ({
  composition,
  userEmail,
  currentCloudId,
  currentCloudName,
  onLoad,
  onNew,
  onCloudMetaChange,
  onCloudSaved,
}) => {
  const [open, setOpen] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudList, setCloudList] = useState<SavedComposition[]>([]);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentId(currentCloudId ?? null);
  }, [currentCloudId]);

  useEffect(() => {
    if (currentCloudName) {
      setSaveName(currentCloudName);
    }
  }, [currentCloudName]);

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
        setSaveName('');
        writeLastCompositionRef(null);
        onCloudMetaChange?.({ id: null, name: '' });
      } catch {
        alert('Invalid composition file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const loadMovementGraphExample = () => {
    onLoad(movementOverTimeExample);
    setCurrentId(null);
    setSaveName('Movement over Time demo');
    writeLastCompositionRef(null);
    onCloudMetaChange?.({ id: null, name: 'Movement over Time demo' });
    close();
  };

  const loadNeyLessonExample = () => {
    onLoad(neyLessonExample);
    setCurrentId(null);
    setSaveName('Ney lesson demo');
    writeLastCompositionRef(null);
    onCloudMetaChange?.({ id: null, name: 'Ney lesson demo' });
    close();
  };

  // ── Cloud ───────────────────────────────────────────────────────────────────

  const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

  const openCloud = async () => {
    const token = getToken();
    if (!token) { setError('Sign in to use cloud save.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${VEMOTION_API}/compositions`, {
        headers: { 'X-API-Token': token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCloudList(data.compositions ?? []);
      setShowCloud(true);
    } catch {
      setError('Failed to load compositions from cloud.');
    } finally {
      setLoading(false);
    }
  };

  const saveToCloud = async () => {
    if (!getToken()) { setError('Sign in to use cloud save.'); return; }
    const name = saveName.trim() || `Composition ${new Date().toLocaleDateString()}`;
    setSaving(true);
    setError('');
    try {
      const data = await saveCompositionToCloud({
        id: currentId ?? undefined,
        name,
        composition,
        saveType: 'manual',
      });
      setCurrentId(data.id);
      setSaveName(name);
      onCloudMetaChange?.({ id: data.id, name });
      onCloudSaved?.({ id: data.id, name, version: data.version });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const loadFromCloud = async (id: string) => {
    const token = getToken();
    if (!token) { setError('Sign in to use cloud save.'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await getCompositionFromCloud(id);
      onLoad(data.composition);
      setCurrentId(data.id);
      setSaveName(data.name);
      writeLastCompositionRef({ id: data.id, name: data.name });
      onCloudMetaChange?.({ id: data.id, name: data.name });
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
    const token = getToken();
    if (!token) return;
    await fetch(`${VEMOTION_API}/composition?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-API-Token': token },
    });
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
                <MenuItem icon={<FolderOpen className="w-4 h-4" />} label="Load movement graph demo" onClick={loadMovementGraphExample} />
                <MenuItem icon={<FolderOpen className="w-4 h-4" />} label="Load ney lesson demo" onClick={loadNeyLessonExample} />
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
                        <p className="text-xs text-slate-500">{new Date(c.updatedAt).toLocaleDateString()}</p>
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
