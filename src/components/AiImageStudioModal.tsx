import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, Loader2, ImagePlus, RotateCcw, Upload, Sparkles, Images, Search } from 'lucide-react';
import type { CompositionData, Layer } from '../lib/api';
import {
  generateAiImageToAlbum,
  describeImageAsPrompt,
  listAlbums,
  listAlbumImages,
  trackUnsplashDownload,
  type AlbumImage,
  type StockImage,
} from '../lib/photoAlbum';
import { StockImagePicker } from './StockImagePicker';

interface AiImageStudioModalProps {
  composition: CompositionData;
  /** Insert the generated image as a new image layer in the composition. */
  onAddLayer: (layer: Layer) => void;
  onClose: () => void;
  /** Disables Generate + shows a sign-in note when absent (upload needs auth). */
  userEmail?: string;
}

// Local id generator — mirrors AddLayerModal's so layers built here are unique
// even within the same millisecond.
let idCounter = 0;
const generateId = () => `layer-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

// gpt-image supported sizes mapped to plain aspect choices.
const ASPECTS = [
  { key: 'square', label: 'Square', sub: '1:1', size: '1024x1024' },
  { key: 'landscape', label: 'Landscape', sub: '3:2', size: '1536x1024' },
  { key: 'portrait', label: 'Portrait', sub: '2:3', size: '1024x1536' },
] as const;
type AspectKey = (typeof ASPECTS)[number]['key'];

// Render quality (gpt-image enum) — the main speed lever. Draft (low) is much
// faster + cheaper for iterating on a prompt; High for the final render.
const QUALITIES = [
  { key: 'low', label: 'Draft', sub: 'fastest' },
  { key: 'medium', label: 'Standard', sub: 'balanced' },
  { key: 'high', label: 'High', sub: 'best' },
] as const;
type QualityKey = (typeof QUALITIES)[number]['key'];

// gpt-image-1-mini is a smaller, faster model — useful for rough prompt tests.
const MODELS = [
  { key: 'gpt-image-2', label: 'Best', sub: 'gpt-image-2' },
  { key: 'gpt-image-1-mini', label: 'Fast', sub: 'mini' },
] as const;
type ModelKey = (typeof MODELS)[number]['key'];

// Style presets append proven phrasing to the prompt so the user doesn't have
// to know the vocabulary the model responds to.
const STYLES: { key: string; label: string; phrase: string }[] = [
  { key: 'none', label: 'No preset', phrase: '' },
  { key: 'photo', label: 'Photographic', phrase: 'photorealistic photograph, natural lighting, high detail' },
  { key: 'flat', label: 'Flat illustration', phrase: 'flat vector illustration, bold simple shapes, clean edges' },
  { key: '3d', label: '3D render', phrase: '3D render, soft studio lighting, subtle shadows' },
  { key: 'watercolor', label: 'Watercolor', phrase: 'watercolor painting, soft washes, textured paper' },
  { key: 'lineart', label: 'Line art', phrase: 'minimal line art, single-weight strokes, monochrome' },
  { key: 'pixel', label: 'Pixel art', phrase: 'pixel art, limited palette, crisp pixels' },
  { key: 'cinematic', label: 'Cinematic', phrase: 'cinematic, dramatic lighting, shallow depth of field' },
  { key: 'anime', label: 'Anime', phrase: 'anime style, cel shading, expressive' },
  { key: 'isometric', label: 'Isometric infographic', phrase: 'isometric vector infographic illustration, flat colors with soft gradients and long shadows, clean thin line work, technical explainer diagram style, white background' },
];

/**
 * Standalone AI image generator. Reached from the File menu — a fuller surface
 * than the inline `AiImagePrompt` in the Images tab: style presets, aspect
 * ratio, a dedicated text-in-image field, and quality hints, all composed into
 * a single prompt so users don't have to know how to phrase one. Generated
 * images are saved to the VEmotion album (by generateAiImageToAlbum) and can be
 * inserted directly as an image layer.
 */
export const AiImageStudioModal: React.FC<AiImageStudioModalProps> = ({
  composition,
  onAddLayer,
  onClose,
  userEmail,
}) => {
  const [subject, setSubject] = useState('');
  const [style, setStyle] = useState<string>('none');
  const [aspect, setAspect] = useState<AspectKey>('square');
  const [textInImage, setTextInImage] = useState('');
  const [avoid, setAvoid] = useState('');
  const [highDetail, setHighDetail] = useState(false);
  const [minimal, setMinimal] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [spaceForText, setSpaceForText] = useState(false);
  const [noText, setNoText] = useState(false);

  const [quality, setQuality] = useState<QualityKey>('low');
  const [model, setModel] = useState<ModelKey>('gpt-image-2');

  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  // "Start from an image" — pick a reference (upload / album / stock / paste),
  // analyze it into prompt text. refImage holds a data URL or a public URL;
  // both work as the vision model's image_url.
  const [refImage, setRefImage] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [refSource, setRefSource] = useState<'album' | 'stock' | null>(null);
  const [albums, setAlbums] = useState<string[]>([]);
  const [album, setAlbum] = useState('VEmotion');
  const [albumImages, setAlbumImages] = useState<AlbumImage[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);

  // Clear the elapsed-time ticker if the modal unmounts mid-generation.
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  // Load albums + images when the album panel opens (or the album changes).
  useEffect(() => {
    if (refSource !== 'album') return;
    let cancelled = false;
    if (albums.length === 0) {
      listAlbums().then(a => { if (!cancelled && a.length) setAlbums(a); }).catch(() => {});
    }
    setAlbumLoading(true);
    listAlbumImages(album)
      .then(imgs => { if (!cancelled) setAlbumImages(imgs); })
      .catch(() => { if (!cancelled) setAlbumImages([]); })
      .finally(() => { if (!cancelled) setAlbumLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refSource, album]);

  // Paste an image from the clipboard anywhere in the modal → reference image.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              setRefImage(typeof reader.result === 'string' ? reader.result : '');
              setRefSource(null);
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const buildPrompt = (): string => {
    let p = subject.trim();
    if (textInImage.trim()) {
      p += `. Include the text "${textInImage.trim()}", clearly and legibly rendered`;
    }
    const descriptors: string[] = [];
    const stylePhrase = STYLES.find(s => s.key === style)?.phrase;
    if (stylePhrase) descriptors.push(stylePhrase);
    if (highDetail) descriptors.push('highly detailed, intricate');
    if (minimal) descriptors.push('minimal, simple composition, generous negative space');
    if (transparent) descriptors.push('isolated subject on a plain transparent background');
    if (spaceForText) descriptors.push('leave generous clean negative space and uncluttered margins so captions can be added on top later, no baked-in text labels');
    if (descriptors.length) p += `. Style: ${descriptors.join(', ')}`;
    if (avoid.trim()) p += `. Avoid: ${avoid.trim()}`;
    // Emphatic, standalone no-text clause — image models honour negation more
    // reliably when it is explicit and forceful than when buried in style text.
    if (noText) p += '. IMPORTANT: render absolutely NO text — no letters, words, numbers, captions, labels, signage, watermarks, or signatures anywhere in the image. A purely visual image with zero typography.';
    return p;
  };

  const finalPrompt = buildPrompt();
  const aspectDef = ASPECTS.find(a => a.key === aspect)!;
  const canGenerate = !!subject.trim() && !!userEmail && !generating;

  const generate = () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError('');
    setResultUrl('');
    setElapsed(0);
    // Non-blocking: the modal stays open and the prompt/settings remain
    // editable while this runs; a ticker shows elapsed seconds so a slow
    // render doesn't look frozen.
    const start = Date.now();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    const stopTimer = () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
    generateAiImageToAlbum(finalPrompt, { size: aspectDef.size, model, quality })
      .then(setResultUrl)
      .catch((e) => setError(e instanceof Error ? e.message : 'Generation failed. Try a different prompt.'))
      .finally(() => { setGenerating(false); stopTimer(); });
  };

  // Measure the generated image, clamp to the canvas (aspect preserved),
  // centre it, and insert as an image layer — same shape the Images tab builds.
  const addToComposition = () => {
    if (!resultUrl || adding) return;
    setAdding(true);
    const finish = (w: number, h: number) => {
      const scale = Math.min(
        w > composition.width ? composition.width / w : 1,
        h > composition.height ? composition.height / h : 1,
      );
      const lw = Math.round(w * scale);
      const lh = Math.round(h * scale);
      onAddLayer({
        id: generateId(),
        type: 'image',
        position: { x: Math.round((composition.width - lw) / 2), y: Math.round((composition.height - lh) / 2) },
        size: { width: lw, height: lh },
        properties: { src: resultUrl, fit: 'cover', name: subject.trim().slice(0, 60) || 'AI image' },
      });
      setAdding(false);
      onClose();
    };
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => finish(el.naturalWidth || 1024, el.naturalHeight || 1024);
    el.onerror = () => finish(Math.round(composition.width / 2), Math.round(composition.height / 2));
    el.src = resultUrl;
  };

  const reset = () => { setResultUrl(''); setError(''); };

  // Read an uploaded reference image as a data URL (kept client-side; only sent
  // to the vision model, not stored in the album).
  const onPickRefImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRefImage(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };

  const pickStockRef = (image: StockImage) => {
    trackUnsplashDownload(image.download_location);
    setRefImage(image.url);
    setRefSource(null);
  };

  // Analyze the reference image into prompt text and drop it into the prompt box.
  const analyzeRefImage = () => {
    if (!refImage || analyzing) return;
    setAnalyzing(true);
    setError('');
    describeImageAsPrompt(refImage)
      .then(text => setSubject(text))
      .catch((e) => setError(e instanceof Error ? e.message : 'Image analysis failed.'))
      .finally(() => setAnalyzing(false));
  };

  // createPortal escapes the sidebar transform ancestor (Lesson 19).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-200">
            <Wand2 className="w-4 h-4 text-sky-400" /> AI Image Studio
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: three columns — Prompt | Settings | Preview (Lesson: long
            prompts need their own tall pane; settings and preview no longer
            fight for the same column). Stacks vertically below lg. */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-5 p-5 overflow-y-auto lg:overflow-hidden">

          {/* Column 1 — Prompt (fills height) + the compiled final prompt */}
          <div className="flex flex-col gap-3 lg:w-[34%] lg:min-h-0">
            {/* Start from an image: pick a reference from upload / album /
                stock / clipboard, then analyze it into prompt text. */}
            <div className="flex-shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/40 dark:bg-slate-800/40 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-500 dark:text-slate-400">Start from an image (optional)</label>
                <span className="text-[10px] text-slate-500">or paste ⌘V / Ctrl+V</span>
              </div>

              {/* Source switcher */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setRefSource(null); fileRef.current?.click(); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload
                </button>
                <button
                  type="button"
                  onClick={() => setRefSource(s => (s === 'album' ? null : 'album'))}
                  className={[
                    'flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition',
                    refSource === 'album' ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                  ].join(' ')}
                >
                  <Images className="w-3.5 h-3.5" /> Album
                </button>
                <button
                  type="button"
                  onClick={() => setRefSource(s => (s === 'stock' ? null : 'stock'))}
                  className={[
                    'flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition',
                    refSource === 'stock' ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                  ].join(' ')}
                >
                  <Search className="w-3.5 h-3.5" /> Stock
                </button>
              </div>

              {/* Album panel */}
              {refSource === 'album' && (
                <div className="space-y-1.5">
                  <select
                    value={album}
                    onChange={e => setAlbum(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {(albums.length ? albums : ['VEmotion']).map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  {albumLoading ? (
                    <div className="flex items-center gap-2 text-slate-500 text-xs py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
                  ) : albumImages.length > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto">
                      {albumImages.map(img => (
                        <button
                          key={img.key}
                          type="button"
                          onClick={() => { setRefImage(img.url); setRefSource(null); }}
                          className={[
                            'aspect-square rounded overflow-hidden border-2 transition',
                            refImage === img.url ? 'border-sky-400 ring-2 ring-sky-400/40' : 'border-slate-200 dark:border-slate-700 hover:border-slate-400',
                          ].join(' ')}
                          title={img.displayName ?? img.name ?? img.key}
                        >
                          <img src={img.url} alt={img.displayName ?? ''} className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">{userEmail ? 'No images in this album.' : 'Sign in to load albums.'}</p>
                  )}
                </div>
              )}

              {/* Stock panel — reuses the Images-tab Unsplash/Pexels picker */}
              {refSource === 'stock' && (
                <StockImagePicker onPick={pickStockRef} pickedUrl={refImage} />
              )}

              {/* Selected reference + analyze */}
              {refImage && (
                <div className="flex items-center gap-2">
                  <img src={refImage} alt="Reference" className="w-12 h-12 rounded object-cover border border-slate-200 dark:border-slate-700 flex-shrink-0" />
                  <button
                    type="button"
                    onClick={analyzeRefImage}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 dark:text-white rounded-lg text-xs font-medium transition"
                  >
                    {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {analyzing ? 'Analyzing…' : 'Describe → prompt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefImage('')}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition"
                    title="Remove reference image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickRefImage} />
              <p className="text-[10px] text-slate-500">Analyzes the image and writes a prompt into the box below — edit it, then Generate.</p>
            </div>
            <div className="flex flex-col flex-1 min-h-0">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">What do you want to see?</label>
              <textarea
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Describe the image in as much detail as you like — subject, setting, mood, colors, composition. Longer, specific prompts give better results."
                className="w-full flex-1 min-h-[160px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex-shrink-0">
              <label className="text-[11px] text-slate-500 block mb-1">Final prompt sent to the model</label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {finalPrompt || <span className="text-slate-600">Describe what you want to see…</span>}
              </div>
            </div>
          </div>

          {/* Column 2 — Settings */}
          <div className="space-y-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Style</label>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyle(s.key)}
                    className={[
                      'px-2.5 py-1 rounded-full text-xs border transition',
                      style === s.key
                        ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Aspect ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECTS.map(a => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAspect(a.key)}
                    className={[
                      'px-2 py-1.5 rounded-lg text-xs border transition flex flex-col items-center',
                      aspect === a.key
                        ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                    ].join(' ')}
                  >
                    <span>{a.label}</span>
                    <span className="text-[10px] opacity-70">{a.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Speed vs quality</label>
              <div className="grid grid-cols-3 gap-2">
                {QUALITIES.map(q => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setQuality(q.key)}
                    className={[
                      'px-2 py-1.5 rounded-lg text-xs border transition flex flex-col items-center',
                      quality === q.key
                        ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                    ].join(' ')}
                  >
                    <span>{q.label}</span>
                    <span className="text-[10px] opacity-70">{q.sub}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">Draft is fastest — iterate your prompt on Draft, then switch to High for the final.</p>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Model</label>
              <div className="grid grid-cols-2 gap-2">
                {MODELS.map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setModel(m.key)}
                    className={[
                      'px-2 py-1.5 rounded-lg text-xs border transition flex flex-col items-center',
                      model === m.key
                        ? 'bg-sky-600 border-sky-500 text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                    ].join(' ')}
                  >
                    <span>{m.label}</span>
                    <span className="text-[10px] opacity-70">{m.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Text to render in the image (optional)</label>
              <input
                value={textInImage}
                onChange={e => setTextInImage(e.target.value)}
                placeholder='e.g. "Autumn Sale"'
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block">Detail & quality</label>
              <div className="flex flex-wrap gap-3 text-xs text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={highDetail} onChange={e => setHighDetail(e.target.checked)} className="accent-sky-500" />
                  High detail
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={minimal} onChange={e => setMinimal(e.target.checked)} className="accent-sky-500" />
                  Simple / minimal
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} className="accent-sky-500" />
                  Transparent background
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={spaceForText} onChange={e => setSpaceForText(e.target.checked)} className="accent-sky-500" />
                  Leave space for captions
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={noText} onChange={e => setNoText(e.target.checked)} className="accent-sky-500" />
                  No text in image
                </label>
              </div>
              {noText && (
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Best effort — the image model has no hard "no text" switch, so it can still
                  occasionally render stray text. Add real labels as text layers for guaranteed clean type.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Avoid (optional)</label>
              <input
                value={avoid}
                onChange={e => setAvoid(e.target.value)}
                placeholder="e.g. text, watermarks, extra limbs"
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Column 3 — Preview */}
          <div className="flex flex-col gap-3 lg:w-[32%] lg:min-h-0">
            <label className="text-xs text-slate-500 dark:text-slate-400 block flex-shrink-0">Preview</label>
            <div className="aspect-square w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-950/60 flex items-center justify-center overflow-hidden flex-shrink-0">
              {generating ? (
                <div className="flex flex-col items-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Generating… {elapsed.toFixed(1)}s
                </div>
              ) : resultUrl ? (
                <img src={resultUrl} alt="Generated" className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-slate-600 text-xs px-6 text-center">
                  Your generated image will appear here. It is saved to your VEmotion album automatically.
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-400 flex-shrink-0">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <p className="text-[11px] text-slate-500">
            {userEmail ? 'Image is saved to your VEmotion album.' : 'Sign in to generate images.'}
          </p>
          <div className="flex items-center gap-2">
            {resultUrl && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Start over
              </button>
            )}
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition bg-sky-600 hover:bg-sky-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 dark:text-white"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {resultUrl ? 'Regenerate' : 'Generate'}
            </button>
            <button
              onClick={addToComposition}
              disabled={!resultUrl || adding}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 dark:text-white"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              Add to composition
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
