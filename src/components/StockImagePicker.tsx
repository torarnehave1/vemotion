import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { searchStockImages, type StockImage, type StockProvider } from '../lib/photoAlbum';

interface StockImagePickerProps {
  /** Called when a result is clicked. The picked image still needs importing
   *  into the album by the caller (importImageUrlToAlbum) for CORS-safe
   *  pixelation; this component only surfaces the choice. */
  onPick: (image: StockImage) => void;
  /** Key of the currently-picked image (for the selection ring), if any. */
  pickedUrl?: string;
  /** Disable interaction (e.g. while the caller is importing/pixelating). */
  busy?: boolean;
}

/**
 * Inline Unsplash + Pexels search panel for the Pixel Grid source picker.
 * Same endpoints as the production ImageSelector.vue (searchStockImages).
 * Lives inside a form (not a modal), so no portal.
 */
export const StockImagePicker: React.FC<StockImagePickerProps> = ({ onPick, pickedUrl, busy }) => {
  const [provider, setProvider] = useState<StockProvider>('unsplash');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSearch = () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError('');
    searchStockImages(provider, query)
      .then((imgs) => {
        setResults(imgs);
        if (imgs.length === 0) setError('No images found. Try different keywords.');
      })
      .catch(() => setError('Search failed.'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-slate-400">Or search stock photos</label>
        <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
          {(['unsplash', 'pexels'] as StockProvider[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`px-2 py-1 text-[11px] capitalize transition ${
                provider === p ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
          placeholder="e.g. turtle, mountain, sunset"
          className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
        </button>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {results.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto">
          {results.map((image, i) => (
            <button
              key={image.url + i}
              type="button"
              disabled={busy}
              onClick={() => onPick(image)}
              title={image.photographer ? `Photo by ${image.photographer}` : image.alt}
              className={`relative aspect-square rounded overflow-hidden border-2 transition disabled:opacity-50 ${
                pickedUrl === image.url ? 'border-sky-400 ring-2 ring-sky-400/40' : 'border-slate-700 hover:border-slate-400'
              }`}
            >
              <img src={image.url} alt={image.alt ?? ''} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        Photos from {provider === 'unsplash' ? 'Unsplash' : 'Pexels'}. Pick one to pixelate it into stitches.
      </p>
    </div>
  );
};
