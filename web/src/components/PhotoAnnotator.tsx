import { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

// Annotation shape — coords normalized to 0..1 so the overlay scales
// with the displayed image. Mirrors the zod schema in api/routes/foto.ts.
export type Shape =
  | { type: 'circle'; x: number; y: number; r: number; color?: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color?: string }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color?: string }
  | { type: 'note'; x: number; y: number; text: string; color?: string };

type Tool = 'circle' | 'rect' | 'arrow' | 'note';

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchAnnotations(fotoId: string): Promise<Shape[]> {
  const r = await axios.get(`${BASE}/foto/${fotoId}/annotations`, {
    withCredentials: true, headers: authHeaders(),
  });
  return r.data.annotations as Shape[];
}

export async function saveAnnotations(fotoId: string, annotations: Shape[]): Promise<void> {
  await axios.patch(`${BASE}/foto/${fotoId}/annotations`, { annotations }, {
    withCredentials: true, headers: authHeaders(),
  });
}

// Renders a photo with an SVG overlay. When `editable`, click-and-drag
// adds shapes; the parent gets the resulting list via onChange.
export function PhotoAnnotator({ src, annotations, onChange, editable }: {
  src: string;
  annotations: Shape[];
  onChange?: (a: Shape[]) => void;
  editable?: boolean;
}) {
  const [tool, setTool] = useState<Tool>('circle');
  const [color, setColor] = useState('#ef4444');
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const update = (next: Shape[]) => onChange?.(next);

  const toLocal = (e: React.MouseEvent): { x: number; y: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!editable) return;
    const p = toLocal(e);
    if (!p) return;
    if (tool === 'note') {
      const text = window.prompt('Catatan:');
      if (!text) return;
      update([...annotations, { type: 'note', x: p.x, y: p.y, text, color }]);
      return;
    }
    setDragging(p);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!editable || !dragging) return;
    const p = toLocal(e);
    if (!p) { setDragging(null); return; }
    let next: Shape | null = null;
    if (tool === 'circle') {
      const r = Math.hypot(p.x - dragging.x, p.y - dragging.y);
      if (r > 0.005) next = { type: 'circle', x: dragging.x, y: dragging.y, r, color };
    } else if (tool === 'rect') {
      const w = p.x - dragging.x, h = p.y - dragging.y;
      if (Math.abs(w) > 0.005 && Math.abs(h) > 0.005) {
        next = { type: 'rect', x: Math.min(dragging.x, p.x), y: Math.min(dragging.y, p.y),
          w: Math.abs(w), h: Math.abs(h), color };
      }
    } else if (tool === 'arrow') {
      if (Math.hypot(p.x - dragging.x, p.y - dragging.y) > 0.01) {
        next = { type: 'arrow', x1: dragging.x, y1: dragging.y, x2: p.x, y2: p.y, color };
      }
    }
    if (next) update([...annotations, next]);
    setDragging(null);
  };

  const removeAt = (i: number) => update(annotations.filter((_, idx) => idx !== i));
  const clearAll = () => { if (window.confirm('Hapus semua anotasi?')) update([]); };

  const cursor = useMemo(() => editable ? 'crosshair' : 'default', [editable]);

  return (
    <div>
      {editable && (
        <div className="center gap-2" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="seg">
            {(['circle', 'rect', 'arrow', 'note'] as Tool[]).map(t => (
              <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>
                {t === 'circle' ? '○' : t === 'rect' ? '▭' : t === 'arrow' ? '→' : '✎'} {t}
              </button>
            ))}
          </div>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', background: 'transparent' }}
            title="Warna" />
          {annotations.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={clearAll}>
              <Ic.x size={12} />Reset
            </button>
          )}
        </div>
      )}
      <div ref={wrapRef}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        style={{
          position: 'relative', cursor,
          width: '100%', overflow: 'hidden', borderRadius: 12,
          background: 'var(--ink)', userSelect: 'none',
        }}>
        <img src={src} alt="" draggable={false}
          style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: editable ? 'none' : 'auto' }}>
          <defs>
            {annotations.filter(a => a.type === 'arrow').map((a, i) => (
              <marker key={`arrowhead-${i}`} id={`arrowhead-${i}`} markerWidth="5" markerHeight="5"
                refX="3.5" refY="2.5" orient="auto" markerUnits="strokeWidth">
                <polygon points="0 0, 5 2.5, 0 5" fill={(a as any).color ?? '#ef4444'} />
              </marker>
            ))}
          </defs>
          {annotations.map((a, i) => (
            <g key={i} onClick={editable ? (e) => { e.stopPropagation(); removeAt(i); } : undefined}
              style={{ cursor: editable ? 'pointer' : 'default' }}>
              {a.type === 'circle' && (
                <circle cx={a.x * 100} cy={a.y * 100} r={a.r * 100}
                  fill="none" stroke={a.color ?? '#ef4444'} strokeWidth={0.6} />
              )}
              {a.type === 'rect' && (
                <rect x={a.x * 100} y={a.y * 100} width={a.w * 100} height={a.h * 100}
                  fill="none" stroke={a.color ?? '#ef4444'} strokeWidth={0.6} />
              )}
              {a.type === 'arrow' && (
                <line x1={a.x1 * 100} y1={a.y1 * 100} x2={a.x2 * 100} y2={a.y2 * 100}
                  stroke={a.color ?? '#ef4444'} strokeWidth={0.7}
                  markerEnd={`url(#arrowhead-${i})`} />
              )}
              {a.type === 'note' && (
                <g>
                  <circle cx={a.x * 100} cy={a.y * 100} r={1.2}
                    fill={a.color ?? '#ef4444'} />
                  <text x={a.x * 100 + 2} y={a.y * 100 - 1.5}
                    fill={a.color ?? '#ef4444'} fontSize="2.2" fontWeight="700"
                    style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 0.4 }}>
                    {a.text}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>
      {editable && annotations.length > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          Klik anotasi untuk hapus · {annotations.length} shape
        </div>
      )}
    </div>
  );
}
