import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { generateAiImageToAlbum } from '../lib/photoAlbum';

interface AiImagePromptProps {
  /** Called with the album (imgix) URL of the generated+stored image. */
  onResult: (albumUrl: string) => void;
  /** Disable while the caller is doing follow-up work (pixelating, etc.). */
  busy?: boolean;
}

/**
 * Inline "ask AI to draw …" panel. Generates an image with gpt-image-2 via the
 * openai-worker, stores it in the VEmotion album, and hands the album URL back.
 * Reused by the Pixel Grid forms (→ pixelate) and the Images tab (→ image layer).
 */
export const AiImagePrompt: React.FC<AiImagePromptProps> = ({ onResult, busy }) => {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const run = () => {
    if (!prompt.trim() || generating || busy) return;
    setGenerating(true);
    setError('');
    generateAiImageToAlbum(prompt)
      .then(onResult)
      .catch(() => setError('Generation failed. Try a different prompt.'))
      .finally(() => setGenerating(false));
  };

  const disabled = generating || busy;

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <label className="text-xs text-slate-400 block">Or ask AI to draw it (gpt-image-2)</label>
      <div className="flex items-center gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
          placeholder="e.g. a turtle, flat colors, simple"
          className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={run}
          disabled={disabled || !prompt.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <p className="text-[10px] text-slate-500">The image is saved to your VEmotion album, then used here.</p>
    </div>
  );
};
