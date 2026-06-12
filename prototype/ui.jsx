/* ============================================================
   UI Components + Charts (SVG)
   ============================================================ */
const { useState, useRef, useEffect } = React;

// ---------- Avatar ----------
function Avatar({ inisial, hue = 156, size = 36, src }) {
  const bg = `oklch(0.58 0.12 ${hue})`;
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: bg }}>
      {inisial}
    </div>
  );
}

// ---------- Kolektabilitas badge ----------
function KolBadge({ kol, withDot = true, full = false }) {
  const k = KOL[kol];
  return (
    <span className="badge" style={{ background: k.soft, color: k.ink }}>
      {withDot && <span className="dot" style={{ background: k.c }} />}
      {full ? k.label : k.short}
    </span>
  );
}

// ---------- Generic badge ----------
function Badge({ children, c = "var(--ink-2)", soft = "var(--surface-2)", icon: Icon }) {
  return (
    <span className="badge" style={{ background: soft, color: c }}>
      {Icon && <Icon size={13} />}
      {children}
    </span>
  );
}

// ---------- Stat card ----------
function Stat({ icon: Icon, label, value, delta, deltaDir, tint = "var(--accent)", soft = "var(--accent-soft)", sub }) {
  return (
    <div className="card card-pad stat fade-up">
      <div className="stat-top">
        <div className="stat-ic" style={{ background: soft, color: tint }}><Icon size={19} /></div>
        <div className="stat-label">{label}</div>
      </div>
      <div className="stat-val num">{value}</div>
      <div className="center gap-2" style={{ flexWrap: "wrap" }}>
        {delta != null && (
          <span className={"stat-delta " + (deltaDir === "down" ? "down" : "up")}>
            {deltaDir === "down" ? <Ic.arrowDown size={14} /> : <Ic.arrowUp size={14} />}{delta}
          </span>
        )}
        {sub && <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{sub}</span>}
      </div>
    </div>
  );
}

// ---------- Donut chart ----------
function Donut({ data, size = 168, thickness = 26, centerLabel, centerSub }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const [hover, setHover] = useState(null);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * C;
          const seg = (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
              stroke={d.color} strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc}
              strokeLinecap="butt"
              style={{ transition: "stroke-width .15s", cursor: "pointer" }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
          acc += dash;
          return seg;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {hover != null ? data[hover].value : centerLabel}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700 }}>
            {hover != null ? data[hover].label : centerSub}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Area + line chart (payment flow) ----------
function AreaChart({ data, w = 640, h = 200, valueKey = "nominal", fmt = (v) => v, targetKey }) {
  const pad = { t: 16, r: 8, b: 26, l: 8 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const vals = data.map(d => d[valueKey]);
  const max = Math.max(...vals, targetKey ? Math.max(...data.map(d => d[targetKey])) : 0) * 1.12;
  const x = (i) => pad.l + (iw * i) / (data.length - 1);
  const y = (v) => pad.t + ih - (ih * v) / max;
  const [hi, setHi] = useState(null);

  const linePts = data.map((d, i) => `${x(i)},${y(d[valueKey])}`).join(" ");
  const areaPts = `${pad.l},${pad.t + ih} ${linePts} ${pad.l + iw},${pad.t + ih}`;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}
      onMouseLeave={() => setHi(null)}>
      <defs>
        <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* grid */}
      {[0.25, 0.5, 0.75, 1].map((g, i) => (
        <line key={i} x1={pad.l} x2={pad.l + iw} y1={pad.t + ih * g} y2={pad.t + ih * g}
          stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
      ))}
      {/* target line */}
      {targetKey && (
        <line x1={pad.l} x2={pad.l + iw} y1={y(data[0][targetKey])} y2={y(data[0][targetKey])}
          stroke="var(--col-dpk)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7" />
      )}
      <polygon points={areaPts} fill="url(#areaG)" />
      <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <rect x={x(i) - iw/(data.length*2)} y={pad.t} width={iw/data.length} height={ih}
            fill="transparent" onMouseEnter={() => setHi(i)} style={{ cursor: "pointer" }} />
          {hi === i && (
            <>
              <line x1={x(i)} x2={x(i)} y1={pad.t} y2={pad.t + ih} stroke="var(--ink-4)" strokeWidth="1" />
              <circle cx={x(i)} cy={y(d[valueKey])} r="5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2.5" />
            </>
          )}
          <text x={x(i)} y={h - 8} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--ink-4)">{d.hari}</text>
        </g>
      ))}
      {hi != null && (
        <g>
          <rect x={Math.min(Math.max(x(hi) - 56, 2), w - 114)} y={6} width="112" height="34" rx="8"
            fill="var(--ink)" />
          <text x={Math.min(Math.max(x(hi) - 56, 2), w - 114) + 12} y={20} fontSize="10" fill="oklch(0.8 0.01 160)" fontWeight="600">{data[hi].masuk} transaksi</text>
          <text x={Math.min(Math.max(x(hi) - 56, 2), w - 114) + 12} y={33} fontSize="12" fill="white" fontWeight="700">{fmt(data[hi][valueKey])}</text>
        </g>
      )}
    </svg>
  );
}

// ---------- Horizontal bar (per petugas) ----------
function HBars({ items, fmt = (v) => v }) {
  const max = Math.max(...items.map(i => i.value)) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((it, i) => (
        <div key={i}>
          <div className="between" style={{ marginBottom: 6 }}>
            <div className="center gap-2">
              {it.avatar}
              <span style={{ fontWeight: 700, fontSize: 13 }}>{it.label}</span>
            </div>
            <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(it.value)}</span>
          </div>
          <div className="progress" style={{ height: 8 }}>
            <span style={{ width: (it.value / max * 100) + "%", background: it.color || "var(--accent)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Mini progress ring ----------
function Ring({ value, size = 44, thickness = 5, color = "var(--accent)" }) {
  const r = (size - thickness) / 2, C = 2 * Math.PI * r;
  const dash = (value / 100) * C;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={thickness}
        strokeDasharray={`${dash} ${C}`} strokeLinecap="round" />
    </svg>
  );
}

// ---------- Stacked bar (postur per wilayah/petugas) ----------
function StackedBar({ segments, height = 12, radius = 6 }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div style={{ display: "flex", height, borderRadius: radius, overflow: "hidden", background: "var(--line)" }}>
      {segments.map((s, i) => (
        <div key={i} title={`${s.label}: ${s.value}`}
          style={{ width: (s.value / total * 100) + "%", background: s.color }} />
      ))}
    </div>
  );
}

// ---------- Image placeholder ----------
function ImgPh({ label, h = 120, style }) {
  return <div className="img-ph" style={{ height: h, ...style }}>{label}</div>;
}

// ---------- Modal ----------
function Modal({ children, onClose, max = 560 }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: max }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ---------- Status pill (petugas) ----------
function StatusPill({ status }) {
  const s = STATUS_PETUGAS[status];
  return (
    <span className="badge" style={{ background: s.soft, color: s.c }}>
      <span className="dot" style={{ background: s.c }} />{s.label}
    </span>
  );
}

Object.assign(window, {
  Avatar, KolBadge, Badge, Stat, Donut, AreaChart, HBars, Ring, StackedBar, ImgPh, Modal, StatusPill,
});
