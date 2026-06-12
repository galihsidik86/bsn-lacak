/* ============================================================
   SCREEN: Tracking Petugas — peta rute + posisi live
   ============================================================ */

// generate a plausible route (list of stops) around an officer position
function makeRoute(p, seed) {
  const cx = 60 + p.posisi.x * 880;
  const cy = 50 + p.posisi.y * 520;
  const rnd = (n) => {
    const x = Math.sin(seed * 99 + n * 17.3) * 10000;
    return x - Math.floor(x);
  };
  const stops = [];
  const n = p.kunjungan;
  let px = cx - 120, py = cy - 60;
  const times = ["07:40","08:15","08:55","09:30","10:10","10:48","11:25","12:30","13:10","13:50","14:35","15:20"];
  for (let i = 0; i < n; i++) {
    px += (rnd(i) - 0.4) * 150;
    py += (rnd(i + 50) - 0.4) * 120;
    px = Math.max(40, Math.min(950, px));
    py = Math.max(40, Math.min(580, py));
    stops.push({ x: px, y: py, t: times[i] || "15:50", idx: i });
  }
  return stops;
}

function ScreenTracking({ go }) {
  const [sel, setSel] = useState("P2");
  const [showAll, setShowAll] = useState(true);
  const p = petugasById(sel);
  const routes = React.useMemo(() => PETUGAS.map((pt, i) => ({ pt, stops: makeRoute(pt, i + 1) })), []);
  const myRoute = routes.find(r => r.pt.id === sel);

  const visitsOf = (pid) => KUNJUNGAN.filter(k => k.petugas === pid);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "318px 1fr", height: "100%", overflow: "hidden" }}>
      {/* LEFT: daftar petugas */}
      <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
        <div style={{ padding: "18px 18px 12px", borderBottom: "1px solid var(--line)" }}>
          <div className="between">
            <div className="section-title">Petugas Lapangan</div>
            <span className="chip"><span className="dot" style={{ background: "var(--accent)" }} />{PETUGAS.filter(x=>x.status==="lapangan").length} aktif</span>
          </div>
          <label className="center gap-2" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Tampilkan semua rute di peta
          </label>
        </div>
        <div style={{ overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {PETUGAS.map(pt => {
            const active = pt.id === sel;
            const pct = Math.round(pt.terkumpul / pt.target * 100);
            return (
              <button key={pt.id} onClick={() => setSel(pt.id)}
                style={{
                  textAlign: "left", border: active ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                  background: active ? "var(--accent-soft)" : "var(--surface)", borderRadius: 14, padding: 12,
                  display: "flex", gap: 11, alignItems: "center", transition: "all .12s",
                }}>
                <div style={{ position: "relative" }}>
                  <Avatar inisial={pt.inisial} hue={pt.hue} size={40} />
                  <span style={{ position: "absolute", right: -2, bottom: -2, width: 13, height: 13, borderRadius: 99,
                    background: STATUS_PETUGAS[pt.status].c, border: "2.5px solid var(--surface)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between">
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{pt.nama}</span>
                    <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)" }}>{pct}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pt.wilayah}</div>
                  <div className="progress" style={{ height: 5, marginTop: 6 }}>
                    <span style={{ width: pct + "%", background: `oklch(0.58 0.12 ${pt.hue})` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: map + timeline */}
      <div style={{ display: "grid", gridTemplateRows: "1fr auto", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "relative", overflow: "hidden", background: "var(--surface-2)" }}>
          <MapCanvas routes={routes} sel={sel} showAll={showAll} setSel={setSel} myRoute={myRoute} />

          {/* floating officer card */}
          <div className="card fade-up" style={{ position: "absolute", top: 16, left: 16, width: 250, padding: 14, boxShadow: "var(--sh-2)" }}>
            <div className="center gap-3">
              <Avatar inisial={p.inisial} hue={p.hue} size={42} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{p.nama}</div>
                <StatusPill status={p.status} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <MiniKv label="Mulai" value={p.mulai} />
              <MiniKv label="Update" value={p.terakhir} />
              <MiniKv label="Kunjungan" value={`${p.kunjungan}/${p.rencana}`} />
              <MiniKv label="Tertagih" value={RPjt(p.terkumpul)} />
            </div>
            <div className="center gap-2" style={{ marginTop: 12 }}>
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }}><Ic.phone size={14} />Hubungi</button>
              <button className="btn btn-sm" onClick={() => go("laporan")}><Ic.clipboard size={14} />Laporan</button>
            </div>
          </div>

          {/* legend */}
          <div className="card" style={{ position: "absolute", bottom: 16, right: 16, padding: "10px 14px", display: "flex", gap: 16, fontSize: 11.5, fontWeight: 700, color: "var(--ink-2)", boxShadow: "var(--sh-2)" }}>
            <span className="center gap-2"><span style={{ width: 16, height: 3, background: "var(--accent)", borderRadius: 2 }} />Rute hari ini</span>
            <span className="center gap-2"><Ic.pin size={14} style={{ color: "var(--accent)" }} />Titik kunjungan</span>
            <span className="center gap-2"><span style={{ width: 11, height: 11, borderRadius: 99, background: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-soft-2)" }} />Posisi live</span>
          </div>
        </div>

        {/* timeline */}
        <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", padding: "14px 20px 18px", maxHeight: 220, overflowY: "auto" }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div className="section-title">Linimasa Pergerakan — {p.nama}</div>
            <span className="chip"><Ic.clock size={13} />Mulai {p.mulai}</span>
          </div>
          <div style={{ display: "flex", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
            {myRoute.stops.map((s, i) => {
              const visit = visitsOf(sel)[i];
              const isNow = i === myRoute.stops.length - 1 && p.status === "lapangan";
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", flex: "none" }}>
                  <div style={{ width: 168, paddingRight: 14 }}>
                    <div className="center gap-2" style={{ marginBottom: 5 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center",
                        background: isNow ? "var(--accent)" : "var(--accent-soft)", color: isNow ? "white" : "var(--accent-ink)",
                        fontWeight: 800, fontSize: 11.5, flex: "none" }}>{i + 1}</span>
                      <span className="num" style={{ fontWeight: 700, fontSize: 12.5 }}>{s.t}</span>
                      {isNow && <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>kini</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {visit ? nasabahById(visit.nasabah)?.nama : "Perjalanan"}
                    </div>
                    {visit && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{HASIL_KUNJUNGAN[visit.hasil].label}</div>}
                  </div>
                  {i < myRoute.stops.length - 1 && (
                    <div style={{ alignSelf: "center", color: "var(--line-2)", marginTop: -18 }}><Ic.arrowRight size={16} /></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniKv({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div className="num" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// ---------- Map canvas (stylized streets) ----------
function MapCanvas({ routes, sel, showAll, setSel, myRoute }) {
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const accent = cssVar("--accent");
  const W = 1000, H = 620;

  // street grid
  const vRoads = [120, 240, 360, 480, 600, 720, 840];
  const hRoads = [90, 200, 310, 420, 530];

  const pathFor = (stops) => stops.map((s, i) => `${i === 0 ? "M" : "L"}${s.x} ${s.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
      style={{ display: "block" }}>
      <rect width={W} height={H} fill="var(--surface-2)" />
      {/* blocks / parks */}
      {[[40,30,140,120,"park"],[600,360,260,180,"park"],[760,40,180,130,"block"],[260,420,180,140,"block"],[420,60,140,90,"block"]].map((b, i) => (
        <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="10"
          fill={b[4] === "park" ? "var(--accent-soft)" : "var(--bg)"} opacity={b[4] === "park" ? 0.7 : 1} />
      ))}
      {/* water */}
      <path d="M0 560 Q 200 520 400 560 T 1000 540 L1000 620 L0 620 Z" fill="oklch(0.9 0.04 230)" opacity="0.55" />

      {/* roads */}
      <g stroke="var(--surface)" strokeWidth="14" strokeLinecap="round">
        {vRoads.map((x, i) => <line key={"v"+i} x1={x} y1={20} x2={x} y2={H-20} />)}
        {hRoads.map((y, i) => <line key={"h"+i} x1={20} y1={y} x2={W-20} y2={y} />)}
      </g>
      <g stroke="var(--line)" strokeWidth="14.5" strokeLinecap="round" opacity="0.5" fill="none">
        {vRoads.map((x, i) => <line key={"vo"+i} x1={x} y1={20} x2={x} y2={H-20} />)}
        {hRoads.map((y, i) => <line key={"ho"+i} x1={20} y1={y} x2={W-20} y2={y} />)}
      </g>

      {/* other officers' routes (faint) */}
      {showAll && routes.filter(r => r.pt.id !== sel).map((r) => (
        <g key={r.pt.id} opacity="0.32">
          <path d={pathFor(r.stops)} fill="none" stroke={`oklch(0.6 0.1 ${r.pt.hue})`} strokeWidth="3"
            strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx={r.stops[r.stops.length-1].x} cy={r.stops[r.stops.length-1].y} r="7"
            fill={`oklch(0.6 0.12 ${r.pt.hue})`} stroke="var(--surface)" strokeWidth="2"
            style={{ cursor: "pointer" }} onClick={() => setSel(r.pt.id)} />
        </g>
      ))}

      {/* selected route */}
      <g>
        <path d={pathFor(myRoute.stops)} fill="none" stroke={accent} strokeWidth="4.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 2px 6px oklch(0.55 0.14 156 / 0.4))" }} />
        {/* stop pins */}
        {myRoute.stops.map((s, i) => {
          const last = i === myRoute.stops.length - 1;
          if (last) return null;
          return (
            <g key={i}>
              <circle cx={s.x} cy={s.y} r="11" fill="var(--surface)" stroke={accent} strokeWidth="3" />
              <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill={accent}>{i + 1}</text>
            </g>
          );
        })}
        {/* live position (last stop) */}
        {(() => {
          const s = myRoute.stops[myRoute.stops.length - 1];
          return (
            <g>
              <circle cx={s.x} cy={s.y} r="22" fill={accent} opacity="0.18">
                <animate attributeName="r" values="14;26;14" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.28;0;0.28" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={s.x} cy={s.y} r="13" fill={accent} stroke="var(--surface)" strokeWidth="3.5" />
              <circle cx={s.x} cy={s.y} r="4" fill="var(--surface)" />
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

window.ScreenTracking = ScreenTracking;
