import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, Loader2, ImagePlus, RotateCcw } from 'lucide-react';
import type { CompositionData, Layer } from '../lib/api';
import { generateAiImageToAlbum } from '../lib/photoAlbum';

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

  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');

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
    generateAiImageToAlbum(finalPrompt, { size: aspectDef.size })
      .then(setResultUrl)
      .catch((e) => setError(e instanceof Error ? e.message : 'Generation failed. Try a different prompt.'))
      .finally(() => setGenerating(false));
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

  // createPortal escapes the sidebar transform ancestor (Lesson 19).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Wand2 className="w-4 h-4 text-sky-400" /> AI Image Studio
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: two columns — controls (left) + preview (right) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 overflow-y-auto">
          {/* Controls */}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">What do you want to see?</label>
              <textarea
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. a red fox curled up asleep in autumn leaves"
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Style</label>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyle(s.key)}
                    className={[
                      'px-2.5 py-1 rounded-full text-xs border transition',
                      style === s.key
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Aspect ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECTS.map(a => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAspect(a.key)}
                    className={[
                      'px-2 py-1.5 rounded-lg text-xs border transition flex flex-col items-center',
                      aspect === a.key
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    <span>{a.label}</span>
                    <span className="text-[10px] opacity-70">{a.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Text to render in the image (optional)</label>
              <input
                value={textInImage}
                onChange={e => setTextInImage(e.target.value)}
                placeholder='e.g. "Autumn Sale"'
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Detail & quality</label>
              <div className="flex flex-wrap gap-3 text-xs text-slate-300">
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
              <label className="text-xs text-slate-400 mb-1 block">Avoid (optional)</label>
              <input
                value={avoid}
                onChange={e => setAvoid(e.target.value)}
                placeholder="e.g. text, watermarks, extra limbs"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <label className="text-xs text-slate-400 block">Preview</label>
            <div className="aspect-square w-full rounded-lg border border-slate-700 bg-slate-950/60 flex items-center justify-center overflow-hidden">
              {generating ? (
                <div className="flex flex-col items-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Generating…
                </div>
              ) : resultUrl ? (
                <img src={resultUrl} alt="Generated" className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-slate-600 text-xs px-6 text-center">
                  Your generated image will appear here. It is saved to your VEmotion album automatically.
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Final prompt sent to the model</label>
              <div className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {finalPrompt || <span className="text-slate-600">Describe what you want to see…</span>}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-800">
          <p className="text-[11px] text-slate-500">
            {userEmail ? 'Image is saved to your VEmotion album.' : 'Sign in to generate images.'}
          </p>
          <div className="flex items-center gap-2">
            {resultUrl && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Start over
              </button>
            )}
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {resultUrl ? 'Regenerate' : 'Generate'}
            </button>
            <button
              onClick={addToComposition}
              disabled={!resultUrl || adding}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
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
