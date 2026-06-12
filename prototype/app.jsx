/* ============================================================
   APP — shell, router, sidebar, topbar, tweaks
   ============================================================ */

const NAV = [
  { group: "Monitoring", items: [
    { k: "dashboard", label: "Dashboard", icon: "dashboard" },
    { k: "tracking", label: "Tracking Petugas", icon: "map" },
    { k: "kolektabilitas", label: "Kolektabilitas", icon: "layers" },
    { k: "angsuran", label: "Pergerakan Angsuran", icon: "chart" },
  ]},
  { group: "Operasional", items: [
    { k: "blast", label: "Blast SMS / WA", icon: "send", badge: SEGMEN.lewat.length },
    { k: "laporan", label: "Laporan Kunjungan", icon: "clipboard" },
    { k: "distribusi", label: "Distribusi Nasabah", icon: "users" },
  ]},
  { group: "Lapangan", items: [
    { k: "mobile", label: "Aplikasi Petugas", icon: "phone" },
  ]},
];

const TITLES = {
  dashboard: ["Dashboard", "Ringkasan operasional penagihan · 11 Juni 2026"],
  tracking: ["Tracking Petugas", "Posisi live & rute kunjungan hari ini"],
  kolektabilitas: ["Postur Kolektabilitas", "Komposisi & detail nasabah binaan"],
  angsuran: ["Pergerakan Angsuran", "Arus pembayaran & ledger transaksi"],
  blast: ["Blast SMS / WhatsApp", "Pengingat jatuh tempo & penagihan massal"],
  laporan: ["Laporan Kunjungan", "Laporan harian petugas beserta foto bukti"],
  distribusi: ["Distribusi Nasabah", "Alokasi nasabah binaan ke petugas lapangan"],
  mobile: ["Aplikasi Petugas Lapangan", "Pratinjau aplikasi mobile kolektor"],
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "hijau",
  "font": "Plus Jakarta Sans",
  "density": "regular",
  "dark": false
}/*EDITMODE-END*/;

const ACCENTS = {
  hijau:  { h: 162, label: "Emerald" },
  teal:   { h: 190, label: "Teal" },
  emas:   { h: 95,  label: "Hijau Emas" },
  navy:   { h: 240, label: "Navy" },
};

function applyAccent(name) {
  const h = ACCENTS[name].h;
  const r = document.documentElement.style;
  r.setProperty("--accent", `oklch(0.57 0.125 ${h})`);
  r.setProperty("--accent-600", `oklch(0.51 0.13 ${h})`);
  r.setProperty("--accent-700", `oklch(0.43 0.115 ${h})`);
  r.setProperty("--accent-soft", `oklch(0.95 0.038 ${h})`);
  r.setProperty("--accent-soft-2", `oklch(0.90 0.056 ${h})`);
  r.setProperty("--accent-ink", `oklch(0.34 0.095 ${h})`);
  r.setProperty("--col-lancar", `oklch(0.60 0.13 ${h})`);
  r.setProperty("--col-lancar-soft", `oklch(0.95 0.038 ${h})`);
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [page, setPage] = useState(() => {
    const h = location.hash.slice(1);
    return TITLES[h] ? h : "dashboard";
  });

  const go = (k) => { setPage(k); location.hash = k; window.scrollTo(0, 0); };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.dark ? "dark" : "light");
    document.documentElement.setAttribute("data-density", t.density);
    document.documentElement.style.setProperty("--font", `"${t.font}", system-ui, sans-serif`);
    applyAccent(t.accent);
  }, [t]);

  const [title, sub] = TITLES[page];

  return (
    <div className="app" data-screen-label={"Page: " + title}>
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="islamic-band" />
          <div className="brand-mark">
            {/* bintang 8 sudut (Rub el Hizb) — dua bujur sangkar bertumpuk */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
              <rect x="5" y="5" width="14" height="14" rx="1.5" transform="rotate(45 12 12)" />
              <circle cx="12" cy="12" r="2.4" fill="var(--gold)" stroke="none" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">BSN Lacak</div>
            <div className="brand-sub">Bank Syariah Nasional</div>
          </div>
        </div>

        {NAV.map(grp => (
          <React.Fragment key={grp.group}>
            <div className="nav-label">{grp.group}</div>
            {grp.items.map(it => {
              const Icon = Ic[it.icon];
              return (
                <button key={it.k} className={"nav-item" + (page === it.k ? " active" : "")} onClick={() => go(it.k)}>
                  <Icon /><span className="lbl">{it.label}</span>
                  {it.badge ? <span className="badge-count num">{it.badge}</span> : null}
                </button>
              );
            })}
          </React.Fragment>
        ))}

        <div className="sidebar-foot">
          <Avatar inisial="SP" hue={162} size={36} />
          <div style={{ flex: 1, minWidth: 0 }} className="brand-text">
            <div style={{ fontWeight: 700, fontSize: 13 }}>Supervisor</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Kepala Cabang</div>
          </div>
          <Ic.logout size={17} style={{ color: "var(--ink-4)" }} />
        </div>
      </aside>

      {/* MAIN */}
      <div className="main">
        <header className="topbar">
          <div style={{ flex: 1 }}>
            <div className="page-title">{title}</div>
            <div className="page-sub">{sub}</div>
          </div>
          <div className="search" style={{ width: 260 }}>
            <Ic.search size={16} />
            <input placeholder="Cari nasabah, petugas, transaksi…" />
          </div>
          <button className="btn btn-ghost" style={{ padding: 9, position: "relative" }}>
            <Ic.bell size={19} />
            <span style={{ position: "absolute", top: 7, right: 8, width: 7, height: 7, borderRadius: 99, background: "var(--col-macet)", border: "1.5px solid var(--surface)" }} />
          </button>
          <button className="btn"><Ic.download size={16} />Ekspor</button>
        </header>

        <main className="main-scroll" style={{ flex: 1, overflow: page === "tracking" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
          {page === "dashboard" && <ScreenDashboard go={go} />}
          {page === "tracking" && <ScreenTracking go={go} />}
          {page === "kolektabilitas" && <ScreenKolektabilitas go={go} />}
          {page === "angsuran" && <ScreenAngsuran />}
          {page === "blast" && <ScreenBlast />}
          {page === "laporan" && <ScreenLaporan />}
          {page === "distribusi" && <ScreenDistribusi />}
          {page === "mobile" && <ScreenMobile />}
        </main>
      </div>

      {/* TWEAKS */}
      <TweaksPanel>
        <TweakSection label="Tema & Warna" />
        <TweakRadio label="Warna aksen" value={t.accent}
          options={Object.keys(ACCENTS)} onChange={v => setTweak("accent", v)} />
        <TweakToggle label="Mode gelap" value={t.dark} onChange={v => setTweak("dark", v)} />
        <TweakSection label="Tipografi & Kepadatan" />
        <TweakSelect label="Font" value={t.font}
          options={["Plus Jakarta Sans", "Manrope", "Figtree", "DM Sans", "Schibsted Grotesk"]}
          onChange={v => setTweak("font", v)} />
        <TweakRadio label="Kepadatan" value={t.density}
          options={["compact", "regular", "comfy"]} onChange={v => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
