import { useState } from 'react';
import { Ic } from '../components/Icons';
import { Avatar, Badge, KolBadge, Modal, StackedBar, StatusPill } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  KOL, RP, RPjt,
  useNasabahFinder, useNasabahList, usePetugasFinder, usePetugasList, useReassign,
} from '../data/queries';
import type { KolKey, Nasabah } from '../types';

export function ScreenDistribusi() {
  const nasabahQ = useNasabahList();
  const petugasQ = usePetugasList();
  const { data: NASABAH } = nasabahQ;
  const { data: PETUGAS } = petugasQ;
  const nasabahById = useNasabahFinder();
  const petugasById = usePetugasFinder();
  const reassignMut = useReassign();

  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const assignOf = (id: string, fallback: string) => overrides[id] ?? fallback;
  const [moving, setMoving] = useState<Nasabah | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadOf = (pid: string) => NASABAH.filter(n => assignOf(n.id, n.petugas) === pid);
  const CAP = 18;

  const doAssign = async (nid: string, pid: string) => {
    setOverrides(a => ({ ...a, [nid]: pid }));
    const n = nasabahById(nid);
    const p = petugasById(pid);
    if (n && p) setToast(`${n.nama} dipindahkan ke ${p.nama}`);
    setTimeout(() => setToast(null), 2600);
    setMoving(null);
    try { await reassignMut.mutateAsync({ nasabahId: nid, petugasId: pid }); } catch { /* swallow */ }
  };

  const autoBalance = () => {
    const m: Record<string, string> = {};
    NASABAH.forEach((n, i) => { m[n.id] = PETUGAS[i % PETUGAS.length].id; });
    setOverrides(m);
    setToast('Distribusi otomatis selesai — beban diseimbangkan');
    setTimeout(() => setToast(null), 2600);
  };

  if (nasabahQ.isPending || petugasQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={200} />)}
        </div>
        <Skeleton h={400} />
      </div>
    );
  }
  if (nasabahQ.error || petugasQ.error) {
    return <div className="content"><ErrorState onRetry={() => { nasabahQ.refetch(); petugasQ.refetch(); }} /></div>;
  }
  if (PETUGAS.length === 0 || NASABAH.length === 0) {
    return <div className="content"><EmptyState title="Belum ada nasabah / petugas" hint="Seed database dulu agar distribusi bisa ditampilkan." /></div>;
  }

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="chip"><Ic.users size={14} />{NASABAH.length} nasabah · {PETUGAS.length} petugas · rata-rata {Math.round(NASABAH.length / PETUGAS.length)}/petugas</div>
        <button className="btn btn-primary" onClick={autoBalance}><Ic.route size={16} />Distribusi Otomatis (Seimbang)</button>
      </div>

      <div className="grid gap-4 fade-up" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 22 }}>
        {PETUGAS.map(p => {
          const load = loadOf(p.id);
          const over = load.length > CAP;
          const outstanding = load.reduce((s, n) => s + n.sisa, 0);
          const segs = ([1, 2, 3, 4, 5] as KolKey[]).map(k => ({
            label: KOL[k].label, value: load.filter(n => n.kol === k).length, color: KOL[k].c,
          }));
          const pct = Math.min(100, Math.round(load.length / CAP * 100));
          return (
            <div key={p.id} className="card card-pad">
              <div className="between">
                <div className="center gap-3">
                  <Avatar inisial={p.inisial} hue={p.hue} size={40} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{p.nama}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{p.wilayah}</div>
                  </div>
                </div>
                <StatusPill status={p.status} />
              </div>
              <div className="between" style={{ marginTop: 16, marginBottom: 7 }}>
                <span className="center gap-2">
                  <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{load.length}</span>
                  <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>nasabah</span>
                </span>
                <span className={over ? 'badge' : 'muted num'}
                  style={over ? { background: 'var(--col-dr-soft)', color: 'var(--col-dr)' } : { fontSize: 11.5, fontWeight: 700 }}>
                  {over ? `+${load.length - CAP} di atas kapasitas` : `kapasitas ${pct}%`}
                </span>
              </div>
              <div className="progress" style={{ height: 7, marginBottom: 12 }}>
                <span style={{ width: pct + '%', background: over ? 'var(--col-dr)' : `oklch(0.58 0.12 ${p.hue})` }} />
              </div>
              <StackedBar segments={segs} />
              <div className="between" style={{ marginTop: 12, fontSize: 12 }}>
                <span className="muted" style={{ fontWeight: 600 }}>Outstanding</span>
                <span className="num" style={{ fontWeight: 700 }}>{RPjt(outstanding)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="between card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div>
            <div className="section-title">Penugasan Nasabah</div>
            <div className="page-sub">Klik tombol pindah untuk realokasi ke petugas lain</div>
          </div>
          <span className="chip"><Ic.filter size={13} />Urut: tunggakan tertinggi</span>
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th>Nasabah</th><th>Kolektabilitas</th><th style={{ textAlign: 'right' }}>Outstanding</th>
              <th>Petugas Saat Ini</th><th></th>
            </tr></thead>
            <tbody>
              {[...NASABAH].sort((a, b) => b.dpd - a.dpd).slice(0, 30).map(n => {
                const p = petugasById(assignOf(n.id, n.petugas));
                if (!p) return null;
                return (
                  <tr key={n.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{n.nama}</div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{n.id} · {n.alamat}</div>
                    </td>
                    <td><KolBadge kol={n.kol} full /></td>
                    <td style={{ textAlign: 'right' }} className="num">{RP(n.sisa)}</td>
                    <td>
                      <div className="center gap-2"><Avatar inisial={p.inisial} hue={p.hue} size={26} />
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.nama}</span></div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm" onClick={() => setMoving(n)}><Ic.route size={14} />Pindah</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {moving && (
        <Modal onClose={() => setMoving(null)} max={420}>
          <div className="modal-head">
            <div style={{ flex: 1 }}>
              <div className="section-title">Pindahkan Nasabah</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{moving.nama} · {moving.alamat}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setMoving(null)}><Ic.x size={16} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PETUGAS.map(p => {
              const isCurrent = assignOf(moving.id, moving.petugas) === p.id;
              const load = loadOf(p.id).length;
              return (
                <button key={p.id} onClick={() => !isCurrent && doAssign(moving.id, p.id)} disabled={isCurrent}
                  className="between" style={{
                    width: '100%', textAlign: 'left', padding: 12, borderRadius: 12,
                    border: isCurrent ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                    background: isCurrent ? 'var(--accent-soft)' : 'var(--surface)',
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}>
                  <div className="center gap-3">
                    <Avatar inisial={p.inisial} hue={p.hue} size={36} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.nama}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{p.wilayah}</div>
                    </div>
                  </div>
                  {isCurrent
                    ? <Badge c="var(--accent)" soft="transparent" icon={Ic.check}>Saat ini</Badge>
                    : <span className="num muted" style={{ fontSize: 12, fontWeight: 700 }}>{load} nasabah</span>}
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fade-up" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
          background: 'var(--ink)', color: 'white', padding: '12px 18px', borderRadius: 12,
          fontWeight: 700, fontSize: 13.5, boxShadow: 'var(--sh-3)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Ic.checkCircle size={18} style={{ color: 'var(--accent)' }} />{toast}
        </div>
      )}
    </div>
  );
}
