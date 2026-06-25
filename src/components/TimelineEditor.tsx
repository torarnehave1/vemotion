import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { CompositionData, Layer, LayerGroup } from '../lib/api';
import { layerLabel } from '../lib/api';
import { ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, Flag, FolderPlus, GripVertical, Pencil, Rows3, TimerReset, Trash2, Ungroup } from 'lucide-react';
import { AddLayerModal } from './AddLayerModal';

interface TimelineEditorProps {
  composition: CompositionData;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onChange: (c: CompositionData) => void;
  /**
   * Shared selected-layer id (from the canvas). The matching layer row is
   * highlighted even when it isn't part of the timeline's own multi-select Set,
   * so selecting a layer on the canvas lights up its row here.
   */
  selectedLayerId?: string | null;
  /** Report a row click up so the canvas selects the same layer. */
  onSelectLayer?: (id: string | null) => void;
}

type DragState =
  | { type: 'move-layer'; layerIds: string[]; anchorLayerId: string; startMouseX: number; originalStarts: Record<string, number> }
  | { type: 'move-group'; groupId: string; layerIds: string[]; startMouseX: number; originalStarts: Record<string, number>; groupStart: number; groupEnd: number }
  | { type: 'resize-right'; layerId: string; startMouseX: number; originalDuration: number; originalStartTime: number }
  | { type: 'resize-left'; layerId: string; startMouseX: number; originalStartTime: number; originalDuration: number };

type BoxSelectState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
};

type TimelineRow =
  | { kind: 'group'; group: LayerGroup; members: Layer[] }
  | { kind: 'layer'; layer: Layer };

const RULER_HEIGHT = 28;
const LAYER_HEIGHT = 36;
const LAYER_GAP = 4;
const LABEL_WIDTH = 190;
const SNAP_PX = 10;

function getLayerColor(layer: Layer): string {
  const c = (layer.properties.color as string) ?? '#0ea5e9';
  return c;
}

function layerStart(layer: Layer): number {
  return layer.startTime ?? 0;
}

function layerDuration(layer: Layer, compositionDuration: number): number {
  const start = layerStart(layer);
  return layer.layerDuration ?? Math.max(0.1, compositionDuration - start);
}

function layerEnd(layer: Layer, compositionDuration: number): number {
  return layerStart(layer) + layerDuration(layer, compositionDuration);
}

function getNextGroupName(groups: LayerGroup[]): string {
  const nums = groups
    .map((g) => {
      const match = g.name.match(/^Group\s+(\d+)$/i);
      return match ? Number(match[1]) : 0;
    })
    .filter(Boolean);
  return `Group ${nums.length ? Math.max(...nums) + 1 : 1}`;
}

function toggleIds(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  composition,
  currentFrame,
  onSeek,
  onChange,
  selectedLayerId: sharedSelectedLayerId,
  onSelectLayer,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [boxSelect, setBoxSelect] = useState<BoxSelectState | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  // Inline rename in the timeline row: id of the layer whose name is being typed.
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);

  const renameLayer = (layerId: string, value: string) => {
    const layers = composition.layers.map((l) =>
      l.id === layerId ? { ...l, name: value.trim() ? value : undefined } : l
    );
    onChange({ ...composition, layers });
  };

  // Reorder = z-order. Layers draw in array order; LATER in the array (lower in
  // this rail) draws ON TOP. 'up' moves a layer one slot earlier (further back),
  // 'down' one slot later (more on top). No-op at the ends.
  const moveLayer = (layerId: string, dir: 'up' | 'down') => {
    const idx = composition.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= composition.layers.length) return;
    const layers = [...composition.layers];
    [layers[idx], layers[target]] = [layers[target], layers[idx]];
    onChange({ ...composition, layers });
  };

  // Drag-to-reorder in the label rail: drop a row above/below another to set
  // z-order in one gesture instead of clicking the arrows repeatedly. A dragged
  // LAYER adopts the target's group membership (drop onto a group's row to join
  // it). A dragged GROUP moves its whole member block as a unit, keeping each
  // member's group membership (groups don't nest here). Row keys: `L:<layerId>`
  // / `G:<groupId>`.
  const [dragItem, setDragItem] = useState<{ kind: 'layer' | 'group'; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; pos: 'above' | 'below' } | null>(null);

  const reorderLayer = (draggedId: string, anchorId: string, pos: 'above' | 'below') => {
    if (draggedId === anchorId) return;
    const layers = [...composition.layers];
    const from = layers.findIndex((l) => l.id === draggedId);
    const anchor = layers.find((l) => l.id === anchorId);
    if (from < 0 || !anchor) return;
    const [moved] = layers.splice(from, 1);
    let to = layers.findIndex((l) => l.id === anchorId);
    if (to < 0) return;
    if (pos === 'below') to += 1;
    layers.splice(to, 0, { ...moved, groupId: anchor.groupId });
    onChange({ ...composition, layers });
  };

  // Move every member of `groupId` as a contiguous block to the drop position.
  const reorderGroup = (groupId: string, target: { kind: 'layer' | 'group'; id: string }, pos: 'above' | 'below') => {
    if (target.kind === 'group' && target.id === groupId) return;
    const members = composition.layers.filter((l) => l.groupId === groupId);
    if (members.length === 0) return;
    const memberIds = new Set(members.map((l) => l.id));
    if (target.kind === 'layer' && memberIds.has(target.id)) return; // dropped onto own member
    const rest = composition.layers.filter((l) => !memberIds.has(l.id));
    let anchorId: string | undefined;
    if (target.kind === 'layer') {
      anchorId = target.id;
    } else {
      const tMembers = rest.filter((l) => l.groupId === target.id);
      if (tMembers.length === 0) return;
      anchorId = pos === 'above' ? tMembers[0].id : tMembers[tMembers.length - 1].id;
    }
    let to = rest.findIndex((l) => l.id === anchorId);
    if (to < 0) return;
    if (pos === 'below') to += 1;
    const layers = [...rest.slice(0, to), ...members, ...rest.slice(to)];
    onChange({ ...composition, layers });
  };

  const handleRowDrop = (targetKind: 'layer' | 'group', targetId: string, pos: 'above' | 'below') => {
    const drag = dragItem;
    setDragItem(null);
    setDropTarget(null);
    if (!drag) return;
    if (drag.kind === 'group') {
      reorderGroup(drag.id, { kind: targetKind, id: targetId }, pos);
      return;
    }
    if (targetKind === 'layer') {
      reorderLayer(drag.id, targetId, pos);
    } else {
      // Layer dropped onto a group's header row → join the group at its edge.
      const tMembers = composition.layers.filter((l) => l.groupId === targetId && l.id !== drag.id);
      if (tMembers.length === 0) return;
      const anchor = pos === 'above' ? tMembers[0].id : tMembers[tMembers.length - 1].id;
      reorderLayer(drag.id, anchor, pos);
    }
  };

  const dropPosFromEvent = (e: React.DragEvent<HTMLElement>): 'above' | 'below' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
  };
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [guideTime, setGuideTime] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);

  const groups = composition.groups ?? [];
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => setTrackWidth(entries[0].contentRect.width));
    obs.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  const pxPerSecond = trackWidth / Math.max(0.1, composition.duration);
  const currentTime = currentFrame / composition.fps;
  const tickInterval = composition.duration <= 10 ? 0.5 : 1;

  const timeFromX = useCallback(
    (x: number) => Math.max(0, Math.min(composition.duration, x / Math.max(pxPerSecond, 0.0001))),
    [pxPerSecond, composition.duration]
  );

  const rows = useMemo<TimelineRow[]>(() => {
    const byGroup = new Map<string, Layer[]>();
    const ungrouped: Layer[] = [];
    for (const layer of composition.layers) {
      if (layer.groupId && groupMap.has(layer.groupId)) {
        const arr = byGroup.get(layer.groupId) ?? [];
        arr.push(layer);
        byGroup.set(layer.groupId, arr);
      } else {
        ungrouped.push(layer);
      }
    }

    const ordered: TimelineRow[] = [];
    const seenGroupIds = new Set<string>();
    for (const layer of composition.layers) {
      if (layer.groupId && groupMap.has(layer.groupId)) {
        const group = groupMap.get(layer.groupId)!;
        if (seenGroupIds.has(group.id)) continue;
        seenGroupIds.add(group.id);
        const members = byGroup.get(group.id) ?? [];
        ordered.push({ kind: 'group', group, members });
        if (!group.collapsed) {
          for (const member of members) ordered.push({ kind: 'layer', layer: member });
        }
      } else if (ungrouped.includes(layer)) {
        ordered.push({ kind: 'layer', layer });
      }
    }
    return ordered;
  }, [composition.layers, groupMap]);

  const totalHeight = RULER_HEIGHT + rows.length * (LAYER_HEIGHT + LAYER_GAP) + 8;
  const editingLayer = composition.layers.find((l) => l.id === editingLayerId) ?? null;

  const seekToClientX = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const frame = Math.round(timeFromX(x) * composition.fps);
    onSeek(Math.max(0, Math.min(frame, Math.floor(composition.duration * composition.fps) - 1)));
  }, [timeFromX, composition.fps, composition.duration, onSeek]);

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    seekToClientX(e.clientX);
    setScrubbing(true);
  };

  const collectSnapTimes = useCallback((excludeLayerIds: string[]): number[] => {
    const times = new Set<number>([0, composition.duration, currentTime]);
    const excluded = new Set(excludeLayerIds);
    for (const layer of composition.layers) {
      if (excluded.has(layer.id)) continue;
      const start = layerStart(layer);
      const end = layerEnd(layer, composition.duration);
      times.add(start);
      times.add(end);
    }
    for (let t = 0; t <= composition.duration; t += tickInterval) {
      times.add(parseFloat(t.toFixed(3)));
    }
    return [...times];
  }, [composition.layers, composition.duration, currentTime, tickInterval]);

  const snapSingleTime = useCallback((candidate: number, snapTimes: number[]) => {
    const threshold = SNAP_PX / Math.max(pxPerSecond, 0.0001);
    let best = candidate;
    let min = Number.POSITIVE_INFINITY;
    for (const t of snapTimes) {
      const diff = Math.abs(candidate - t);
      if (diff <= threshold && diff < min) {
        min = diff;
        best = t;
      }
    }
    return best;
  }, [pxPerSecond]);

  const snapRange = useCallback((start: number, end: number, snapTimes: number[]) => {
    const snappedStart = snapSingleTime(start, snapTimes);
    const snappedEnd = snapSingleTime(end, snapTimes);
    const startDelta = snappedStart - start;
    const endDelta = snappedEnd - end;
    if (Math.abs(startDelta) <= Math.abs(endDelta)) {
      return { delta: startDelta, guide: Math.abs(startDelta) > 0 ? snappedStart : null };
    }
    return { delta: endDelta, guide: Math.abs(endDelta) > 0 ? snappedEnd : null };
  }, [snapSingleTime]);

  const getLayersInSelectionBox = useCallback((selection: BoxSelectState) => {
    const left = Math.min(selection.startX, selection.currentX);
    const right = Math.max(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const bottom = Math.max(selection.startY, selection.currentY);

    const selected = new Set<string>();
    rows.forEach((row, index) => {
      if (row.kind !== 'layer') return;
      const rowTop = RULER_HEIGHT + index * (LAYER_HEIGHT + LAYER_GAP);
      const rowBottom = rowTop + LAYER_HEIGHT;
      if (bottom < rowTop || top > rowBottom) return;

      const start = LABEL_WIDTH + layerStart(row.layer) * pxPerSecond;
      const end = LABEL_WIDTH + (layerStart(row.layer) + layerDuration(row.layer, composition.duration)) * pxPerSecond;
      if (right < start || left > end) return;
      selected.add(row.layer.id);
    });
    return selected;
  }, [composition.duration, pxPerSecond, rows]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const dt = (e.clientX - drag.startMouseX) / Math.max(pxPerSecond, 0.0001);

      if (drag.type === 'move-layer' || drag.type === 'move-group') {
        const layerIds = drag.layerIds;
        const originalStarts = drag.originalStarts;
        const movingLayers = composition.layers.filter((layer) => layerIds.includes(layer.id));
        const earliestStart = Math.min(...movingLayers.map((layer) => originalStarts[layer.id]));
        const latestEnd = Math.max(...movingLayers.map((layer) => originalStarts[layer.id] + layerDuration(layer, composition.duration)));
        const rawStart = earliestStart + dt;
        const rawEnd = latestEnd + dt;
        const maxShiftRight = composition.duration - latestEnd;
        const maxShiftLeft = -earliestStart;
        let boundedDelta = Math.max(maxShiftLeft, Math.min(maxShiftRight, dt));
        const snap = snapRange(rawStart, rawEnd, collectSnapTimes(layerIds));
        boundedDelta = Math.max(maxShiftLeft, Math.min(maxShiftRight, boundedDelta + snap.delta));
        setGuideTime(snap.guide);

        const layers = composition.layers.map((layer) => (
          layerIds.includes(layer.id)
            ? { ...layer, startTime: Math.max(0, originalStarts[layer.id] + boundedDelta) }
            : layer
        ));
        onChange({ ...composition, layers });
        return;
      }

      if (drag.type === 'resize-right') {
        const start = drag.originalStartTime;
        const rawEnd = start + drag.originalDuration + dt;
        const snappedEnd = snapSingleTime(rawEnd, collectSnapTimes([drag.layerId]));
        setGuideTime(snappedEnd !== rawEnd ? snappedEnd : null);
        const newDuration = Math.max(0.1, Math.min(composition.duration - start, snappedEnd - start));
        onChange({
          ...composition,
          layers: composition.layers.map((layer) =>
            layer.id === drag.layerId ? { ...layer, layerDuration: newDuration } : layer
          ),
        });
        return;
      }

      const rawStart = drag.originalStartTime + dt;
      const snappedStart = snapSingleTime(rawStart, collectSnapTimes([drag.layerId]));
      setGuideTime(snappedStart !== rawStart ? snappedStart : null);
      const newStart = Math.max(0, Math.min(drag.originalStartTime + drag.originalDuration - 0.1, snappedStart));
      const newDuration = Math.max(0.1, drag.originalDuration - (newStart - drag.originalStartTime));
      onChange({
        ...composition,
        layers: composition.layers.map((layer) =>
          layer.id === drag.layerId
            ? { ...layer, startTime: newStart, layerDuration: newDuration }
            : layer
        ),
      });
    };

    const onUp = () => {
      setDrag(null);
      setGuideTime(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [collectSnapTimes, composition, onChange, pxPerSecond, snapRange, snapSingleTime, drag]);

  useEffect(() => {
    if (!scrubbing) return;

    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      seekToClientX(e.clientX);
    };
    const onUp = () => setScrubbing(false);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [scrubbing, seekToClientX]);

  useEffect(() => {
    if (!boxSelect) return;

    const onMove = (e: MouseEvent) => {
      if (!bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const next = {
        ...boxSelect,
        currentX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        currentY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
      };
      setBoxSelect(next);
      setSelectedGroupId(null);
      setSelectedLayerIds((prev) => {
        const nextIds = getLayersInSelectionBox(next);
        if (!next.additive) return nextIds;
        const merged = new Set(prev);
        nextIds.forEach((id) => merged.add(id));
        return merged;
      });
    };

    const onUp = () => setBoxSelect(null);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [boxSelect, getLayersInSelectionBox]);

  const selectLayer = (layerId: string, multi: boolean) => {
    setSelectedGroupId(null);
    setSelectedLayerIds((prev) => multi ? toggleIds(prev, layerId) : new Set([layerId]));
    // Push the clicked layer to the shared selection so the canvas selects it too.
    onSelectLayer?.(layerId);
  };

  const selectGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedLayerIds(new Set());
  };

  const startDragMoveLayer = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const activeIds = selectedLayerIds.has(layer.id) && selectedLayerIds.size > 0
      ? [...selectedLayerIds]
      : [layer.id];
    const originalStarts = Object.fromEntries(
      composition.layers
        .filter((item) => activeIds.includes(item.id))
        .map((item) => [item.id, layerStart(item)])
    );
    setDrag({
      type: 'move-layer',
      layerIds: activeIds,
      anchorLayerId: layer.id,
      startMouseX: e.clientX,
      originalStarts,
    });
  };

  const startDragMoveGroup = (e: React.MouseEvent, group: LayerGroup, members: Layer[]) => {
    e.stopPropagation();
    const originalStarts = Object.fromEntries(members.map((item) => [item.id, layerStart(item)]));
    const starts = members.map((item) => layerStart(item));
    const ends = members.map((item) => layerEnd(item, composition.duration));
    setDrag({
      type: 'move-group',
      groupId: group.id,
      layerIds: members.map((item) => item.id),
      startMouseX: e.clientX,
      originalStarts,
      groupStart: Math.min(...starts),
      groupEnd: Math.max(...ends),
    });
  };

  const startDragResizeRight = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const start = layerStart(layer);
    const duration = layerDuration(layer, composition.duration);
    setDrag({ type: 'resize-right', layerId: layer.id, startMouseX: e.clientX, originalDuration: duration, originalStartTime: start });
  };

  const startDragResizeLeft = (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const start = layerStart(layer);
    const duration = layerDuration(layer, composition.duration);
    setDrag({ type: 'resize-left', layerId: layer.id, startMouseX: e.clientX, originalStartTime: start, originalDuration: duration });
  };

  const toggleLayerVisibility = (layerId: string) => {
    onChange({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible: layer.visible === false ? true : false } : layer
      ),
    });
  };

  const toggleGroupVisibility = (groupId: string) => {
    const memberIds = composition.layers.filter((layer) => layer.groupId === groupId).map((layer) => layer.id);
    const members = composition.layers.filter((layer) => memberIds.includes(layer.id));
    const nextVisible = members.some((layer) => layer.visible === false);
    onChange({
      ...composition,
      groups: (composition.groups ?? []).map((group) => group.id === groupId ? { ...group, visible: nextVisible } : group),
      layers: composition.layers.map((layer) =>
        memberIds.includes(layer.id) ? { ...layer, visible: nextVisible } : layer
      ),
    });
  };

  const toggleGroupCollapsed = (groupId: string) => {
    onChange({
      ...composition,
      groups: (composition.groups ?? []).map((group) =>
        group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
      ),
    });
  };

  const groupSelectedLayers = () => {
    const ids = [...selectedLayerIds];
    if (ids.length < 2) return;
    const nextGroupId = `group-${Date.now()}`;
    const nextGroup: LayerGroup = { id: nextGroupId, name: getNextGroupName(composition.groups ?? []), collapsed: false, visible: true };
    onChange({
      ...composition,
      groups: [...(composition.groups ?? []), nextGroup],
      layers: composition.layers.map((layer) =>
        ids.includes(layer.id) ? { ...layer, groupId: nextGroupId } : layer
      ),
    });
    setSelectedLayerIds(new Set());
    setSelectedGroupId(nextGroupId);
  };

  const ungroupSelectedGroup = () => {
    if (!selectedGroupId) return;
    onChange({
      ...composition,
      groups: (composition.groups ?? []).filter((group) => group.id !== selectedGroupId),
      layers: composition.layers.map((layer) =>
        layer.groupId === selectedGroupId ? { ...layer, groupId: undefined } : layer
      ),
    });
    setSelectedGroupId(null);
  };

  const distributeSelectedLayers = () => {
    const ids = [...selectedLayerIds];
    if (ids.length < 3) return;
    const selectedLayers = composition.layers.filter((layer) => ids.includes(layer.id)).sort((a, b) => layerStart(a) - layerStart(b));
    const firstStart = layerStart(selectedLayers[0]);
    const lastStart = layerStart(selectedLayers[selectedLayers.length - 1]);
    const step = (lastStart - firstStart) / (selectedLayers.length - 1);
    const updates = new Map<string, number>();
    selectedLayers.forEach((layer, index) => updates.set(layer.id, firstStart + step * index));
    onChange({
      ...composition,
      layers: composition.layers.map((layer) =>
        updates.has(layer.id) ? { ...layer, startTime: updates.get(layer.id)! } : layer
      ),
    });
  };

  // ── Timeline markers (meta.markers) ───────────────────────────────────────
  // Named time tags stored in composition.meta — editor/agent only, ignored by
  // the renderer and exporter. Let the user pin a labelled marker at the
  // playhead so an agent reading the JSON knows exactly where a change is wanted.
  const markers = composition.meta?.markers ?? [];

  const setMarkers = (next: typeof markers) => {
    onChange({ ...composition, meta: { ...composition.meta, markers: next } });
  };

  const addMarkerAtPlayhead = () => {
    const id = `mk-${Date.now().toString(36)}`;
    const time = Math.round(currentTime * 100) / 100;
    setMarkers([...markers, { id, time, label: '' }].sort((a, b) => a.time - b.time));
    setEditingMarkerId(id);
  };

  const updateMarker = (id: string, patch: Partial<{ time: number; label: string }>) => {
    setMarkers(markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.time - b.time));
  };

  const removeMarker = (id: string) => {
    setMarkers(markers.filter((m) => m.id !== id));
    if (editingMarkerId === id) setEditingMarkerId(null);
  };

  const editingMarker = markers.find((m) => m.id === editingMarkerId) ?? null;

  const insertTimeAtPlayhead = () => {
    const insertAt = currentTime;
    const amount = 1;
    onChange({
      ...composition,
      duration: composition.duration + amount,
      layers: composition.layers.map((layer) => {
        const start = layerStart(layer);
        const end = layerEnd(layer, composition.duration);
        if (start >= insertAt) {
          return { ...layer, startTime: start + amount };
        }
        if (start < insertAt && end > insertAt) {
          return { ...layer, layerDuration: layerDuration(layer, composition.duration) + amount };
        }
        return layer;
      }),
    });
  };

  const startBoxSelection = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!bodyRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-marquee="true"]')) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const additive = e.metaKey || e.ctrlKey;
    if (!additive) {
      setSelectedLayerIds(new Set());
      setSelectedGroupId(null);
    }
    setBoxSelect({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      additive,
    });
  };

  const ticks: number[] = [];
  for (let t = 0; t <= composition.duration; t += tickInterval) {
    ticks.push(parseFloat(t.toFixed(2)));
  }

  // Shared native-DnD handlers for a label row (layer or group header).
  const dndRowProps = (kind: 'layer' | 'group', id: string, canDrag: boolean) => ({
    draggable: canDrag,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${kind}:${id}`);
      setDragItem({ kind, id });
    },
    onDragEnd: () => { setDragItem(null); setDropTarget(null); },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragItem || (dragItem.kind === kind && dragItem.id === id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const pos = dropPosFromEvent(e);
      const key = `${kind === 'group' ? 'G' : 'L'}:${id}`;
      setDropTarget((prev) => (prev?.key === key && prev.pos === pos ? prev : { key, pos }));
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      handleRowDrop(kind, id, dropPosFromEvent(e));
    },
  });

  const dropEdgeClass = (key: string) => [
    dropTarget?.key === key && dropTarget.pos === 'above' && 'shadow-[inset_0_2px_0_0_#38bdf8]',
    dropTarget?.key === key && dropTarget.pos === 'below' && 'shadow-[inset_0_-2px_0_0_#38bdf8]',
  ];

  const renderLabelRow = (row: TimelineRow) => {
    if (row.kind === 'group') {
      const members = row.members;
      const anyHidden = members.every((layer) => layer.visible === false);
      const dragging = dragItem?.kind === 'group' && dragItem.id === row.group.id;
      return (
        <div
          key={`group-${row.group.id}`}
          data-no-marquee="true"
          {...dndRowProps('group', row.group.id, true)}
          className={[
            'flex items-center px-3 text-xs text-slate-700 dark:text-slate-300 gap-1 transition bg-slate-100/50 dark:bg-slate-800/50 cursor-grab active:cursor-grabbing',
            dragging && 'opacity-40',
            selectedGroupId === row.group.id && 'ring-1 ring-sky-500/60',
            ...dropEdgeClass(`G:${row.group.id}`),
          ].join(' ')}
          style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}
          onClick={() => selectGroup(row.group.id)}
          title="Drag to reorder the whole group"
        >
          <GripVertical className="w-3 h-3 flex-shrink-0 text-slate-500" />
          <button data-no-marquee="true" className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition p-0.5" onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(row.group.id); }}>
            {row.group.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <span className="font-medium truncate flex-1">{row.group.name}</span>
          <button data-no-marquee="true" className="text-slate-500 dark:text-slate-400 hover:text-sky-400 transition p-0.5" onClick={(e) => { e.stopPropagation(); toggleGroupVisibility(row.group.id); }} title={anyHidden ? 'Show group' : 'Hide group'}>
            {anyHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      );
    }

    const layer = row.layer;
    const dragging = dragItem?.kind === 'layer' && dragItem.id === layer.id;
    return (
      <div
        key={layer.id}
        data-no-marquee="true"
        {...dndRowProps('layer', layer.id, renamingLayerId !== layer.id)}
        className={[
          'flex items-center px-3 text-xs text-slate-500 dark:text-slate-400 truncate gap-1 transition cursor-grab active:cursor-grabbing',
          layer.visible === false && 'opacity-50',
          dragging && 'opacity-40',
          (selectedLayerIds.has(layer.id) || layer.id === sharedSelectedLayerId) && 'ring-1 ring-sky-500/60 bg-slate-100/40 dark:bg-slate-800/40',
          ...dropEdgeClass(`L:${layer.id}`),
          layer.groupId && 'pl-8',
        ].join(' ')}
        style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}
        onClick={(e) => selectLayer(layer.id, e.metaKey || e.ctrlKey)}
      >
        <GripVertical className="w-3 h-3 flex-shrink-0 text-slate-600" />
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getLayerColor(layer) }} />
        {renamingLayerId === layer.id ? (
          <input
            data-no-marquee="true"
            autoFocus
            defaultValue={layer.name ?? ''}
            placeholder={layer.id}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { renameLayer(layer.id, e.target.value); setRenamingLayerId(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { renameLayer(layer.id, (e.target as HTMLInputElement).value); setRenamingLayerId(null); }
              else if (e.key === 'Escape') { setRenamingLayerId(null); }
            }}
            className="flex-1 min-w-0 bg-slate-200 dark:bg-slate-700 border border-sky-500 text-slate-900 dark:text-white text-xs rounded px-1 py-0.5 focus:outline-none"
          />
        ) : (
          <span
            className="truncate flex-1 cursor-text"
            title={`${layerLabel(layer)} — double-click to rename`}
            onDoubleClick={(e) => { e.stopPropagation(); setRenamingLayerId(layer.id); }}
          >
            {layerLabel(layer)}
          </span>
        )}
        <button data-no-marquee="true" disabled={composition.layers[0]?.id === layer.id} className="text-slate-500 dark:text-slate-400 hover:text-sky-400 disabled:opacity-25 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400 transition flex-shrink-0 p-0.5" onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }} title="Move back (render behind the layer above)">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button data-no-marquee="true" disabled={composition.layers[composition.layers.length - 1]?.id === layer.id} className="text-slate-500 dark:text-slate-400 hover:text-sky-400 disabled:opacity-25 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400 transition flex-shrink-0 p-0.5" onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }} title="Move forward (render on top of the layer below)">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button data-no-marquee="true" className="text-slate-500 dark:text-slate-400 hover:text-sky-400 transition flex-shrink-0 p-0.5" onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }} title={layer.visible === false ? 'Show layer' : 'Hide layer'}>
          {layer.visible === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button data-no-marquee="true" className="text-slate-500 dark:text-slate-400 hover:text-sky-400 transition flex-shrink-0 p-0.5" onClick={(e) => { e.stopPropagation(); setEditingLayerId(layer.id); }} title="Edit layer">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const renderTrackRow = (row: TimelineRow) => {
    if (row.kind === 'group') {
      const starts = row.members.map((layer) => layerStart(layer));
      const ends = row.members.map((layer) => layerEnd(layer, composition.duration));
      const groupStart = Math.min(...starts);
      const groupEnd = Math.max(...ends);
      const left = groupStart * pxPerSecond;
      const width = Math.max(4, (groupEnd - groupStart) * pxPerSecond);
      const hidden = row.members.every((layer) => layer.visible === false);
      return (
        <div key={`track-group-${row.group.id}`} className="relative" style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}>
          <div
            data-no-marquee="true"
            className={[
              'absolute top-1 rounded flex items-center cursor-grab active:cursor-grabbing',
              selectedGroupId === row.group.id && 'ring-1 ring-sky-500/60',
            ].join(' ')}
            style={{
              left,
              width,
              height: LAYER_HEIGHT - 8,
              backgroundColor: '#94a3b833',
              border: '1px solid #94a3b888',
              opacity: hidden ? 0.35 : 1,
            }}
            onMouseDown={(e) => startDragMoveGroup(e, row.group, row.members)}
            onClick={() => selectGroup(row.group.id)}
          >
            <span className="text-[10px] px-3 truncate flex-1 text-slate-700 dark:text-slate-300">{row.group.name}</span>
          </div>
        </div>
      );
    }

    const layer = row.layer;
    const start = layerStart(layer);
    const duration = layerDuration(layer, composition.duration);
    const left = start * pxPerSecond;
    const width = Math.max(4, duration * pxPerSecond);
    const color = getLayerColor(layer);
    return (
      <div key={`track-${layer.id}`} className="relative" style={{ height: LAYER_HEIGHT, marginBottom: LAYER_GAP }}>
        <div
          data-no-marquee="true"
          className={[
            'absolute top-1 rounded cursor-grab active:cursor-grabbing flex items-center group',
            (selectedLayerIds.has(layer.id) || layer.id === sharedSelectedLayerId) && 'ring-1 ring-sky-500/60',
          ].join(' ')}
          style={{
            left,
            width,
            height: LAYER_HEIGHT - 8,
            backgroundColor: color + '33',
            border: `1px solid ${color}88`,
            opacity: layer.visible === false ? 0.35 : 1,
          }}
          onMouseDown={(e) => startDragMoveLayer(e, layer)}
          onClick={(e) => {
            e.stopPropagation();
            selectLayer(layer.id, e.metaKey || e.ctrlKey);
          }}
        >
          <div data-no-marquee="true" className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l" style={{ backgroundColor: color + '66' }} onMouseDown={(e) => startDragResizeLeft(e, layer)} />
          <span className="text-[10px] px-3 truncate flex-1" style={{ color }}>
            {(layer.name && layer.name.trim()) || (layer.properties.text as string) || layer.type}
          </span>
          <div data-no-marquee="true" className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r" style={{ backgroundColor: color + '66' }} onMouseDown={(e) => startDragResizeRight(e, layer)} />
        </div>
      </div>
    );
  };

  return (
    <>
      {editingLayer && (
        <AddLayerModal
          editingLayer={editingLayer}
          compositionDuration={composition.duration}
          compositionWidth={composition.width}
          compositionHeight={composition.height}
          onAdd={(updated) => onChange({ ...composition, layers: composition.layers.map((l) => l.id === updated.id ? updated : l) })}
          onSetCompositionDuration={(seconds) => onChange({ ...composition, duration: Math.max(composition.duration, seconds) })}
          onUpdateMeta={(patch) => {
            // Editing an audio layer can swap the r2Url — re-analysis flows
            // back through here. Same merge as the add path.
            onChange({ ...composition, meta: { ...composition.meta, ...patch } });
          }}
          onClose={() => setEditingLayerId(null)}
          compositionScale={composition.meta?.scale?.mmPerPx}
          onSetCompositionScale={(mmPerPx) => onChange({ ...composition, meta: { ...composition.meta, scale: { mmPerPx } } })}
        />
      )}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Timeline</span>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
              onClick={groupSelectedLayers}
              disabled={selectedLayerIds.size < 2}
              title="Group selected layers"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Group
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
              onClick={ungroupSelectedGroup}
              disabled={!selectedGroupId}
              title="Ungroup selected group"
            >
              <Ungroup className="w-3.5 h-3.5" />
              Ungroup
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
              onClick={distributeSelectedLayers}
              disabled={selectedLayerIds.size < 3}
              title="Distribute selected layers by start time"
            >
              <Rows3 className="w-3.5 h-3.5" />
              Distribute
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              onClick={insertTimeAtPlayhead}
              title="Insert 1 second at playhead"
            >
              <TimerReset className="w-3.5 h-3.5" />
              Add 1s
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
              onClick={addMarkerAtPlayhead}
              title="Add a labelled marker at the playhead (stored in meta — for sharing with an agent)"
            >
              <Flag className="w-3.5 h-3.5" />
              Marker
            </button>
          </div>
          <span className="text-xs text-slate-500">
            {composition.duration}s · {composition.fps}fps · {composition.layers.length} layers
            {markers.length > 0 && ` · ${markers.length} marker${markers.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Marker editor — appears when a marker flag is added/clicked. */}
        {editingMarker && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-violet-500/5">
            <Flag className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
            <input
              autoFocus
              value={editingMarker.label}
              placeholder="What happens here? (note for you / an agent)"
              onChange={(e) => updateMarker(editingMarker.id, { label: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingMarkerId(null); }}
              className="flex-1 min-w-0 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
              <span>at</span>
              <input
                type="number" min={0} max={composition.duration} step={0.1}
                value={editingMarker.time}
                onChange={(e) => updateMarker(editingMarker.id, { time: Math.max(0, Math.min(composition.duration, parseFloat(e.target.value) || 0)) })}
                className="w-16 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span>s</span>
            </label>
            <button onClick={() => removeMarker(editingMarker.id)} title="Delete marker" className="text-slate-500 dark:text-slate-400 hover:text-red-400 transition flex-shrink-0 p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setEditingMarkerId(null)} className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-200 hover:bg-slate-600 flex-shrink-0">Done</button>
          </div>
        )}

        <div
          ref={bodyRef}
          className="flex relative"
          style={{ minHeight: totalHeight }}
          onMouseDown={startBoxSelection}
        >
          <div className="flex-shrink-0 border-r border-slate-200 dark:border-slate-800" style={{ width: LABEL_WIDTH, paddingTop: RULER_HEIGHT }}>
            {rows.map(renderLabelRow)}
          </div>

          <div ref={trackRef} className="flex-1 relative select-none overflow-hidden">
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 cursor-pointer" style={{ height: RULER_HEIGHT }} onMouseDown={handleRulerMouseDown}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left: t * pxPerSecond }}>
                  <div className="w-px bg-slate-600" style={{ height: t % 1 === 0 ? 10 : 6, marginTop: 4 }} />
                  {t % 1 === 0 && <span className="text-[10px] text-slate-500 mt-0.5">{t}s</span>}
                </div>
              ))}
            </div>

            {rows.map(renderTrackRow)}

            {guideTime !== null && trackWidth > 0 && (
              <div
                className="absolute top-0 bottom-0 w-px bg-amber-400/90 pointer-events-none z-20"
                style={{ left: guideTime * pxPerSecond }}
              />
            )}

            {/* Timeline markers — full-height violet line + a clickable flag on the ruler. */}
            {trackWidth > 0 && markers.map((m) => (
              <div key={m.id} className="absolute top-0 bottom-0 z-20" style={{ left: m.time * pxPerSecond }}>
                <div className="absolute top-0 bottom-0 w-px bg-violet-400/70 pointer-events-none" />
                <button
                  data-no-marquee="true"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setEditingMarkerId(m.id); }}
                  title={m.label || 'Marker (click to edit)'}
                  className={[
                    'absolute top-0 flex items-center gap-1 h-[18px] pl-0.5 pr-1.5 rounded-r rounded-bl text-[10px] whitespace-nowrap max-w-[160px] pointer-events-auto transition',
                    editingMarkerId === m.id ? 'bg-violet-500 text-slate-900 dark:text-white' : 'bg-violet-500/80 text-slate-900 dark:text-white hover:bg-violet-500',
                  ].join(' ')}
                  style={{ left: 0 }}
                >
                  <Flag className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">{m.label || `${m.time}s`}</span>
                </button>
              </div>
            ))}

            {trackWidth > 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-sky-400 pointer-events-none z-20" style={{ left: currentTime * pxPerSecond }}>
                <div
                  data-no-marquee="true"
                  className="absolute -top-1 w-4 h-4 cursor-ew-resize pointer-events-auto"
                  style={{ left: -8 }}
                  onMouseDown={handleRulerMouseDown}
                >
                  <div className="w-3 h-3 bg-sky-400 rotate-45 absolute top-0" style={{ left: 2 }} />
                </div>
              </div>
            )}
          </div>

          {boxSelect && (
            <div
              className="absolute border border-sky-400/80 bg-sky-400/10 pointer-events-none z-30"
              style={{
                left: Math.min(boxSelect.startX, boxSelect.currentX),
                top: Math.min(boxSelect.startY, boxSelect.currentY),
                width: Math.abs(boxSelect.currentX - boxSelect.startX),
                height: Math.abs(boxSelect.currentY - boxSelect.startY),
              }}
            />
          )}
        </div>
      </div>
    </>
  );
};
