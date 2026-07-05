import React, { useState } from 'react';
import { ChevronDown, Download, Loader2, Share2, GraduationCap, ListVideo, Instagram, Image as ImageIcon } from 'lucide-react';
import type { CompositionData } from '../lib/api';
import { exportToMp4, type ExportProgress } from '../lib/exporter';
import { saveAsTrainingVideo } from '../lib/trainingVideo';
import { exportFramePng, captureFramePngBlob, exportSlidesPng, carouselSlideTimes } from '../lib/screenshot';
import { uploadImageToAlbum, VEMOTION_ALBUM } from '../lib/photoAlbum';
import TrainingVideosModal from './TrainingVideosModal';
import { PostCarouselModal } from './PostCarouselModal';
import { PostVideoModal } from './PostVideoModal';

interface ExportShareMenuProps {
  composition: CompositionData;
  /** Playhead frame, so "Export PNG" / "Save PNG" capture the frame on screen. */
  currentFrame?: number;
}

/**
 * Two header dropdowns — "Export" (local downloads) and "Share" (publish /
 * save destinations) — replacing the flat 8-button stack that used to sit at
 * the bottom of the sidebar below the whole layer list. Self-contained: owns
 * all its own render/upload/post state and modals, takes only the composition
 * + current frame. Mirrors FileMenu's dropdown pattern (relative wrapper +
 * fixed-inset backdrop + absolute panel); the header has no transform ancestor
 * so no portal is needed (Lesson 19 applies to the modals, which do portal).
 */
export const ExportShareMenu: React.FC<ExportShareMenuProps> = ({ composition, currentFrame = 0 }) => {
  const [openMenu, setOpenMenu] = useState<null | 'export' | 'share'>(null);
  const close = () => setOpenMenu(null);

  // ── Export MP4 ──────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress(null);
    try {
      await exportToMp4(composition, (p) => setExportProgress(p));
    } catch (err) {
      console.error('Export failed:', err);
      setExportProgress({ stage: 'done', percent: 0, message: 'Export failed. See console for details.' });
    } finally {
      setExporting(false);
    }
  };

  // ── Export PNG (current frame) ──────────────────────────────────────────────
  const [exportingPng, setExportingPng] = useState(false);
  const handleExportPng = async () => {
    if (exportingPng) return;
    setExportingPng(true);
    try {
      await exportFramePng(composition, Math.max(0, Math.round(currentFrame)));
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setExportingPng(false);
    }
  };

  // ── Export slides (PNG set) ─────────────────────────────────────────────────
  const [exportingSlides, setExportingSlides] = useState(false);
  const [slidesProgress, setSlidesProgress] = useState('');
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const handleExportSlides = async () => {
    if (exportingSlides) return;
    setExportingSlides(true);
    setSlidesError(null);
    try {
      const times = carouselSlideTimes(composition);
      setSlidesProgress(`0/${times.length}`);
      await exportSlidesPng(
        composition,
        times,
        composition.meta?.carousel?.fileBase ?? 'slide',
        (done, total) => setSlidesProgress(`${done}/${total}`),
      );
    } catch (err) {
      console.error('Slide export failed:', err);
      setSlidesError('Slide export failed. See console.');
    } finally {
      setExportingSlides(false);
      setSlidesProgress('');
    }
  };

  // ── Save as training video ──────────────────────────────────────────────────
  const [savingTraining, setSavingTraining] = useState(false);
  const [trainingUrl, setTrainingUrl] = useState<string | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState('');
  const [showTrainingManager, setShowTrainingManager] = useState(false);
  const handleSaveAsTraining = async () => {
    if (savingTraining || exporting) return;
    const title = window.prompt('Title for this training video:', 'Vemotion training video');
    if (!title || !title.trim()) return;
    setSavingTraining(true);
    setTrainingUrl(null);
    setTrainingError(null);
    setTrainingProgress('Rendering…');
    try {
      const blob = await exportToMp4(composition, (p) => setTrainingProgress(p.message), { download: false });
      const result = await saveAsTrainingVideo(blob, title.trim(), (p) => setTrainingProgress(p.message));
      setTrainingUrl(result.playUrl);
    } catch (err) {
      console.error('Save as training video failed:', err);
      setTrainingError(err instanceof Error ? err.message : 'Failed to save training video.');
    } finally {
      setSavingTraining(false);
      setTrainingProgress('');
    }
  };

  // ── Save PNG to album ───────────────────────────────────────────────────────
  const [savingPng, setSavingPng] = useState(false);
  const [pngAlbumUrl, setPngAlbumUrl] = useState<string | null>(null);
  const [pngAlbumError, setPngAlbumError] = useState<string | null>(null);
  const handleSavePngToAlbum = async () => {
    if (savingPng) return;
    setSavingPng(true);
    setPngAlbumUrl(null);
    setPngAlbumError(null);
    try {
      const frame = Math.max(0, Math.round(currentFrame));
      const blob = await captureFramePngBlob(composition, frame);
      const file = new File([blob], `vemotion-frame-${frame}.png`, { type: 'image/png' });
      const url = await uploadImageToAlbum(file);
      setPngAlbumUrl(url);
    } catch (err) {
      console.error('Save PNG to album failed:', err);
      setPngAlbumError('Save failed. See console.');
    } finally {
      setSavingPng(false);
    }
  };

  const [showPostCarousel, setShowPostCarousel] = useState(false);
  const [showPostVideo, setShowPostVideo] = useState(false);

  const anyBusy = exporting || exportingPng || exportingSlides || savingTraining || savingPng;

  return (
    <div className="flex items-center gap-2">
      {/* Export dropdown */}
      <div className="relative">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-200 text-sm rounded-lg border border-slate-200 dark:border-slate-700 transition flex-shrink-0"
          onClick={() => setOpenMenu((m) => (m === 'export' ? null : 'export'))}
          title="Download this composition"
        >
          {exporting || exportingPng || exportingSlides ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {openMenu === 'export' && (
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
              <MenuItem
                icon={<Download className="w-4 h-4" />}
                label="Export MP4"
                busy={exporting}
                busyLabel={exportProgress?.message ?? 'Preparing…'}
                onClick={handleExport}
              />
              <MenuItem
                icon={<ImageIcon className="w-4 h-4" />}
                label="Export PNG (screenshot)"
                busy={exportingPng}
                busyLabel="Exporting…"
                onClick={handleExportPng}
              />
              <MenuItem
                icon={<ImageIcon className="w-4 h-4" />}
                label="Export slides (PNG set)"
                busy={exportingSlides}
                busyLabel={`Exporting… ${slidesProgress}`}
                onClick={handleExportSlides}
              />
              {slidesError && <p className="px-4 pb-2 text-xs text-red-400">{slidesError}</p>}
            </div>
          </>
        )}
      </div>

      {/* Share dropdown */}
      <div className="relative">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-200 text-sm rounded-lg border border-slate-200 dark:border-slate-700 transition flex-shrink-0"
          onClick={() => setOpenMenu((m) => (m === 'share' ? null : 'share'))}
          title="Publish or save this composition"
        >
          {savingTraining || savingPng ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          Share <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {openMenu === 'share' && (
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
              <MenuItem
                icon={<Instagram className="w-4 h-4" />}
                label="Post as Instagram carousel"
                onClick={() => { setShowPostCarousel(true); close(); }}
              />
              <MenuItem
                icon={<Instagram className="w-4 h-4" />}
                label="Post as Instagram video (Reel)"
                onClick={() => { setShowPostVideo(true); close(); }}
              />
              <div className="h-px bg-slate-100 dark:bg-slate-800 mx-3" />
              <MenuItem
                icon={<ImageIcon className="w-4 h-4" />}
                label={`Save PNG to ${VEMOTION_ALBUM} album`}
                busy={savingPng}
                busyLabel="Saving to album…"
                onClick={handleSavePngToAlbum}
              />
              {pngAlbumUrl && (
                <p className="px-4 pb-2 text-xs text-emerald-400">
                  Saved.{' '}
                  <a href={pngAlbumUrl} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300" onClick={(e) => e.stopPropagation()}>View image</a>
                </p>
              )}
              {pngAlbumError && <p className="px-4 pb-2 text-xs text-red-400">{pngAlbumError}</p>}
              <div className="h-px bg-slate-100 dark:bg-slate-800 mx-3" />
              <MenuItem
                icon={<GraduationCap className="w-4 h-4" />}
                label="Save as training video"
                busy={savingTraining}
                busyLabel={trainingProgress || 'Saving…'}
                onClick={handleSaveAsTraining}
              />
              {trainingUrl && (
                <p className="px-4 pb-2 text-xs text-emerald-400">
                  Saved to Academy as a draft.{' '}
                  <a href={trainingUrl} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300" onClick={(e) => e.stopPropagation()}>View video</a>
                </p>
              )}
              {trainingError && <p className="px-4 pb-2 text-xs text-red-400">{trainingError}</p>}
              <MenuItem
                icon={<ListVideo className="w-4 h-4" />}
                label="Manage training videos"
                onClick={() => { setShowTrainingManager(true); close(); }}
              />
            </div>
          </>
        )}
      </div>

      {/* MP4 export progress — inline under the header while rendering (the
          modal-free actions have no other place to surface a long progress). */}
      {exporting && exportProgress && (
        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-shrink-0 max-w-[16rem] truncate" title={exportProgress.message}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {Math.round(exportProgress.percent)}%
        </span>
      )}
      {anyBusy && !exporting && (
        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
        </span>
      )}

      {showTrainingManager && <TrainingVideosModal onClose={() => setShowTrainingManager(false)} />}
      {showPostCarousel && <PostCarouselModal composition={composition} onClose={() => setShowPostCarousel(false)} />}
      {showPostVideo && <PostVideoModal composition={composition} onClose={() => setShowPostVideo(false)} />}
    </div>
  );
};

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  busyLabel?: string;
}> = ({ icon, label, onClick, busy, busyLabel }) => (
  <button
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition text-left disabled:opacity-60"
    onClick={onClick}
    disabled={busy}
  >
    <span className="text-slate-500 dark:text-slate-400">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}</span>
    {busy ? (busyLabel ?? 'Working…') : label}
  </button>
);
