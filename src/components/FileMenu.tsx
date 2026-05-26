import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FilePlus, FileJson, Save, Upload, FolderOpen, Loader2 } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { readStoredUser } from '../lib/auth';
import { saveCompositionToCloud, writeLastCompositionRef } from '../lib/cloud-compositions';
import { movementOverTimeExample, neyLessonExample } from '../lib/examples';
import { CompositionJsonModal } from './CompositionJsonModal';
import { PortfolioModal } from './PortfolioModal';

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
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentId(currentCloudId ?? null);
  }, [currentCloudId]);

  useEffect(() => {
    if (currentCloudName) {
      setSaveName(currentCloudName);
    }
  }, [currentCloudName]);

  const close = () => { setOpen(false); setError(''); };

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
    setSaveName('Flute solfège demo');
    writeLastCompositionRef(null);
    onCloudMetaChange?.({ id: null, name: 'Flute solfège demo' });
    close();
  };

  // ── Cloud save ──────────────────────────────────────────────────────────────
  // The "open / browse / delete" surface lives in PortfolioModal now; this
  // helper only handles the inline "Save to cloud" button at the bottom of
  // the File menu.

  const getToken = () => readStoredUser()?.emailVerificationToken ?? null;

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

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg border border-slate-700 transition"
        onClick={() => { setOpen(o => !o); setError(''); }}
      >
        File <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">

            {/*
              Cloud-list panel (showCloud) replaced by PortfolioModal — opens
              full-screen on top of the editor with search / sort / tag /
              category / metaArea filters + per-card edit. The File menu
              entry just toggles the modal now.
            */}
            <MenuItem icon={<FilePlus className="w-4 h-4" />} label="New composition" onClick={() => { onNew(); close(); }} />
            <MenuItem icon={<FolderOpen className="w-4 h-4" />} label="Load movement graph demo" onClick={loadMovementGraphExample} />
            <MenuItem icon={<FolderOpen className="w-4 h-4" />} label="Load flute solfège demo" onClick={loadNeyLessonExample} />
            <div className="h-px bg-slate-800 mx-3" />
            <MenuItem icon={<Save className="w-4 h-4" />} label="Save to computer" onClick={saveToComputer} />
            <MenuItem icon={<FileJson className="w-4 h-4" />} label="View JSON" onClick={() => { setShowJson(true); close(); }} />
            <MenuItem icon={<Upload className="w-4 h-4" />} label="Load from computer" onClick={loadFromComputer} />
            <div className="h-px bg-slate-800 mx-3" />
            <MenuItem icon={<FolderOpen className="w-4 h-4" />} label="Open Portfolio…" onClick={() => { setShowPortfolio(true); close(); }} />
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
          </div>
        </>
      )}

      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />

      {showJson && (
        <CompositionJsonModal composition={composition} onClose={() => setShowJson(false)} />
      )}

      {showPortfolio && (
        <PortfolioModal
          userEmail={userEmail}
          onClose={() => setShowPortfolio(false)}
          onOpen={(comp, id, name) => {
            // Mirror the existing loadFromCloud flow: hand the composition to
            // the parent and update cloud metadata so autosave knows the id.
            onLoad(comp);
            setCurrentId(id);
            setSaveName(name);
            writeLastCompositionRef({ id, name });
            onCloudMetaChange?.({ id, name });
          }}
        />
      )}
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
