import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { SavedFilters } from '../components/SavedFilters';
import { PhotoAnnotator, saveAnnotations } from '../components/PhotoAnnotator';
import { Avatar, Badge, ImgPh, KolBadge, Kv, Modal, Stat } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  HASIL_KUNJUNGAN, RP,
  useKunjunganList, useNasabahFinder, usePetugasFinder, usePetugasList,
  useReviewKunjungan,
} from '../data/queries';
import { downloadAuthed } from '../lib/download';
import { useAuth } from '../lib/auth';
import type { HasilKunjungan, Kunjungan, Nasabah, Petugas } from '../types';

const RISK_FLAG_META: Record<string, { label: string; hint: string }> = {
  gps_far: { label: 'GPS jauh dari nasabah', hint: 'Lokasi laporan > 200m dari alamat nasabah.' },
  gps_missing: { label: 'GPS tidak dikirim', hint: 'Klien tidak melampirkan koordinat saat submit.' },
  photo_no_exif: { label: 'Foto tanpa metadata', hint: 'Foto tidak punya EXIF — kemungkinan dari galeri / di-edit.' },
  photo_stale: { label: 'Foto lama', hint: 'Foto diambil > 1 jam sebelum laporan dikirim.' },
  speed_jump: { label: 'Lonjakan kecepatan', hint: 'Petugas berpindah > 150 km/h antara dua ping GPS.' },
};

export function ScreenLaporan() {
  const kunjunganQ = useKunjunganList();
  const petugasQ = usePetugasList();
  const { data: KUNJUNGAN } = kunjunganQ;
  const { data: PETUGAS } = petugasQ;
  const petugasById = usePetugasFinder();
  const nasabahById = useNasabahFinder();

  const [fPet, setFPet] = useState<'all' | string>('all');
  const [fHasil, setFHasil] = useState<'all' | HasilKunjungan>('all');
  const [fReview, setFReview] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [sel, setSel] = useState<Kunjungan | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const user = useAuth(s => s.user);
  const canReview = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  // Clear selection when filter changes — selections from a stale row set
  // shouldn't bleed across filter changes.
  function setFilterReview(v: typeof fReview) { setFReview(v); setBulkSelected(new Set()); }

  const rows = KUNJUNGAN.filter(k =>
    (fPet === 'all' || k.petugas === fPet) &&
    (fHasil === 'all' || k.hasil === fHasil) &&
    (fReview === 'all' || k.reviewStatus?.toLowerCase() === fReview)
  );

  const pendingCount = KUNJUNGAN.filter(k => k.reviewStatus === 'PENDING').length;

  const counts = (Object.keys(HASIL_KUNJUNGAN) as HasilKunjungan[])
    .map(h => ({ h, n: KUNJUNGAN.filter(k => k.hasil === h).length }));

  if (kunjunganQ.isPending || petugasQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={120} />)}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={260} />)}
        </div>
      </div>
    );
  }
  if (kunjunganQ.error || petugasQ.error) {
    return <div className="content"><ErrorState onRetry={() => { kunjunganQ.refetch(); petugasQ.refetch(); }} /></div>;
  }
  if (KUNJUNGAN.length === 0) {
    return <div className="content"><EmptyState title="Belum ada laporan kunjungan" hint="Laporan akan muncul setelah petugas mengisi via app mobile." /></div>;
  }

  return (
    <div className="content">
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <Stat icon={Ic.clipboard} label="Total Kunjungan" value={KUNJUNGAN.length} sub="hari ini" />
        {counts.slice(0, 3).map(({ h, n }) => {
          const hk = HASIL_KUNJUNGAN[h];
          const icon = h === 'bayar' ? Ic.wallet : h === 'janji' ? Ic.clock : Ic.user;
          return <Stat key={h} icon={icon} label={hk.label} value={n} tint={hk.c} soft={hk.soft}
            sub={Math.round(n / KUNJUNGAN.length * 100) + '% dari kunjungan'} />;
        })}
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden', marginBottom: 4 }}>
        <div className="between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
          <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={fPet} onChange={e => setFPet(e.target.value)}>
              <option value="all">Semua petugas</option>
              {PETUGAS.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </select>
            <div className="seg">
              <button className={fHasil === 'all' ? 'on' : ''} onClick={() => setFHasil('all')}>Semua</button>
              {(Object.entries(HASIL_KUNJUNGAN) as [HasilKunjungan, typeof HASIL_KUNJUNGAN[HasilKunjungan]][]).map(([k, v]) => (
                <button key={k} className={fHasil === k ? 'on' : ''} onClick={() => setFHasil(k)}>
                  {v.label.split('/')[0].split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
          <div className="seg" role="tablist" aria-label="Filter status review">
            <button className={fReview === 'all' ? 'on' : ''} onClick={() => setFilterReview('all')}>Semua status</button>
            <button className={fReview === 'pending' ? 'on' : ''} onClick={() => setFilterReview('pending')}>
              Pending {pendingCount > 0 && <span className="num" style={{ marginLeft: 4 }}>· {pendingCount}</span>}
            </button>
            <button className={fReview === 'approved' ? 'on' : ''} onClick={() => setFilterReview('approved')}>Disetujui</button>
            <button className={fReview === 'rejected' ? 'on' : ''} onClick={() => setFilterReview('rejected')}>Ditolak</button>
          </div>
          <div className="center gap-2">
            <BulkPdfButton petugasId={fPet === 'all' ? undefined : fPet} />
            <span className="chip"><Ic.calendar size={13} />{new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
          <SavedFilters
            screen="laporan"
            currentPayload={{ fPet, fHasil, fReview }}
            onLoad={(p: { fPet: 'all' | string; fHasil: 'all' | HasilKunjungan; fReview: typeof fReview }) => {
              setFPet(p.fPet); setFHasil(p.fHasil); setFilterReview(p.fReview);
            }}
          />
        </div>
      </div>

      {canReview && fReview === 'pending' && rows.length > 0 && (
        <BulkReviewBar
          allPendingIds={rows.filter(k => k.reviewStatus === 'PENDING').map(k => k.id)}
          selected={bulkSelected}
          setSelected={setBulkSelected}
          note={bulkNote}
          setNote={setBulkNote}
          busy={bulkBusy}
          err={bulkErr}
          onApply={async (status) => {
            if (bulkSelected.size === 0) return;
            setBulkBusy(true); setBulkErr(null);
            try {
              const tok = (await import('../lib/api')).tokenStore.get();
              const r = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/kunjungan/bulk-review`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({ ids: [...bulkSelected], status, note: bulkNote || undefined }),
              });
              if (!r.ok) throw new Error('bulk_review_failed');
              setBulkSelected(new Set()); setBulkNote('');
              kunjunganQ.refetch();
            } catch {
              setBulkErr('Gagal menerapkan bulk review.');
            } finally {
              setBulkBusy(false);
            }
          }}
        />
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 16 }}>
        {rows.map(k => {
          const p = petugasById(k.petugas);
          const n = nasabahById(k.nasabah);
          if (!p || !n) return null;
          const h = HASIL_KUNJUNGAN[k.hasil];
          return (
            <button key={k.id} onClick={() => setSel(k)} className="card fade-up"
              style={{ textAlign: 'left', overflow: 'hidden', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative' }}>
                {canReview && fReview === 'pending' && k.reviewStatus === 'PENDING' && (
                  <input type="checkbox"
                    checked={bulkSelected.has(k.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      const next = new Set(bulkSelected);
                      if (e.target.checked) next.add(k.id); else next.delete(k.id);
                      setBulkSelected(next);
                    }}
                    style={{
                      position: 'absolute', top: 10, left: 10, zIndex: 2,
                      width: 20, height: 20, accentColor: 'var(--accent)', cursor: 'pointer',
                    }} />
                )}
                <ImgPh label={`◦ FOTO KUNJUNGAN ◦\n${n.nama}`} h={150}
                  style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid var(--line)', whiteSpace: 'pre-line' }} />
                <span className="badge" style={{ position: 'absolute', top: 10, left: canReview && fReview === 'pending' && k.reviewStatus === 'PENDING' ? 40 : 10, background: h.soft, color: h.c, boxShadow: 'var(--sh-1)' }}>{h.label}</span>
                <span style={{ position: 'absolute', top: 10, right: 10, background: 'var(--ink)', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 11, fontWeight: 700 }} className="center gap-2">
                  <Ic.camera size={12} />{k.foto}
                </span>
                {k.reviewStatus === 'PENDING' && (
                  <span style={{ position: 'absolute', top: 40, right: 10, background: 'var(--col-macet)', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 10.5, fontWeight: 700 }} className="center gap-2">
                    <Ic.alert size={12} />Pending review
                  </span>
                )}
                {k.reviewStatus === 'REJECTED' && (
                  <span style={{ position: 'absolute', top: 40, right: 10, background: 'var(--ink)', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 10.5, fontWeight: 700 }} className="center gap-2">
                    <Ic.x size={12} />Ditolak
                  </span>
                )}
                <span style={{ position: 'absolute', bottom: 10, left: 10, background: 'color-mix(in oklch, var(--ink) 78%, transparent)', color: 'white', borderRadius: 7, padding: '3px 8px', fontSize: 10.5, fontWeight: 600 }} className="center gap-2">
                  <Ic.pin size={11} />{k.lokasi}
                </span>
              </div>
              <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="between">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{n.nama}</div>
                  <KolBadge kol={n.kol} />
                </div>
                <div style={{
                  fontSize: 12.5, color: 'var(--ink-2)', marginTop: 8, lineHeight: 1.5, flex: 1,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{k.catatan}</div>
                <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div className="center gap-2"><Avatar inisial={p.inisial} hue={p.hue} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{p.nama.split(' ')[0]}</span></div>
                  <span className="num muted center gap-2" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    <Ic.clock size={12} />{k.jam}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {sel && <LaporanDetail k={sel} onClose={() => setSel(null)}
        petugasById={petugasById} nasabahById={nasabahById} />}
    </div>
  );
}

// Photo strip with click-to-zoom lightbox AND supervisor annotation mode.
// Each foto carries its server-side id + saved annotation list. When the
// supervisor toggles "Anotasi", clicks become a shape draw and changes
// are persisted via PATCH /api/foto/:id/annotations.
function FotoGallery({ fotos, nasabahNama, canAnnotate }: {
  fotos: { id: string; url: string; annotations: any[] }[];
  nasabahNama: string;
  canAnnotate: boolean;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [localAnnotations, setLocalAnnotations] = useState<Record<string, any[]>>(
    () => Object.fromEntries(fotos.map(f => [f.id, f.annotations ?? []])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  const urls = fotos.map(f => f.url);
  const activeFoto = fotos[activeIdx];

  if (urls.length === 0) {
    return (
      <div style={{ marginBottom: 18 }}>
        <ImgPh label={`◦ TIDAK ADA FOTO ◦\n${nasabahNama}`} h={220} style={{ whiteSpace: 'pre-line' }} />
      </div>
    );
  }

  const saveActive = async () => {
    if (!activeFoto) return;
    setSavingId(activeFoto.id);
    try {
      await saveAnnotations(activeFoto.id, localAnnotations[activeFoto.id] ?? []);
    } catch { /* ignore — keep edits local */ }
    finally { setSavingId(null); }
  };

  return (
    <>
      {canAnnotate && (
        <div className="between" style={{ marginBottom: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {annotateMode ? 'Klik tombol bawah untuk simpan ke server.' : 'Anotasi membantu petugas memahami feedback Anda.'}
          </div>
          <div className="center gap-2">
            <button className="btn btn-sm" onClick={() => setAnnotateMode(m => !m)}
              style={annotateMode ? { background: 'var(--accent)', color: 'white', border: 'none' } : {}}>
              <Ic.settings size={12} />{annotateMode ? 'Selesai anotasi' : 'Mulai anotasi'}
            </button>
            {annotateMode && (
              <button className="btn btn-sm btn-primary" onClick={saveActive} disabled={!!savingId}>
                <Ic.checkCircle size={12} />{savingId ? 'Menyimpan…' : 'Simpan'}
              </button>
            )}
          </div>
        </div>
      )}

      {annotateMode && activeFoto ? (
        <div style={{ marginBottom: 18 }}>
          <PhotoAnnotator src={activeFoto.url}
            annotations={localAnnotations[activeFoto.id] ?? []}
            editable={true}
            onChange={a => setLocalAnnotations(s => ({ ...s, [activeFoto.id]: a }))} />
          {urls.length > 1 && (
            <div className="center gap-2" style={{ marginTop: 8 }}>
              {urls.map((_, i) => (
                <button key={i} className={'btn btn-sm ' + (i === activeIdx ? '' : 'btn-ghost')}
                  onClick={() => setActiveIdx(i)}>
                  Foto {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="grid gap-2" style={{
        gridTemplateColumns: urls.length > 1 ? '2fr 1fr' : '1fr', marginBottom: 18,
      }}>
        <button onClick={() => setLightboxIdx(activeIdx)}
          style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'zoom-in', position: 'relative' }}>
          {(localAnnotations[activeFoto?.id ?? ''] ?? []).length > 0 ? (
            <PhotoAnnotator src={urls[activeIdx]}
              annotations={localAnnotations[activeFoto!.id] ?? []} />
          ) : (
            <img src={urls[activeIdx]} alt={`Foto utama ${nasabahNama}`}
              style={{
                width: '100%', height: urls.length > 1 ? 220 : 240,
                objectFit: 'cover', borderRadius: 12, background: 'var(--ink)',
                border: '1px solid var(--line)', display: 'block',
              }} />
          )}
        </button>
        {urls.length > 1 && (
          <div className="grid gap-2" style={{ gridTemplateRows: urls.length > 2 ? '1fr 1fr' : '1fr' }}>
            {urls.slice(1, 3).map((url, i) => {
              const idx = i + 1;
              return (
                <button key={idx} onClick={() => setActiveIdx(idx)}
                  style={{
                    padding: 0, border: idx === activeIdx ? '2px solid var(--accent)' : '1px solid var(--line)',
                    background: 'transparent', cursor: 'pointer', borderRadius: 12, overflow: 'hidden',
                  }}>
                  <img src={url} alt={`Foto ${idx + 1}`}
                    style={{
                      width: '100%', height: urls.length > 2 ? 106 : 220,
                      objectFit: 'cover', background: 'var(--ink)', display: 'block',
                    }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {lightboxIdx !== null && (
        <Lightbox
          urls={urls}
          startIndex={lightboxIdx}
          alt={`Foto kunjungan ${nasabahNama}`}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}

function Lightbox({ urls, startIndex, alt, onClose }: {
  urls: string[]; startIndex: number; alt: string; onClose: () => void;
}) {
  const [i, setI] = useState(startIndex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setI(p => (p - 1 + urls.length) % urls.length);
      else if (e.key === 'ArrowRight') setI(p => (p + 1) % urls.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [urls.length, onClose]);

  return (
    <div role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200,
        display: 'grid', placeItems: 'center', padding: 24,
      }}>
      <img src={urls[i]} alt={alt}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 96px)', objectFit: 'contain' }} />
      <div style={{ position: 'absolute', top: 18, right: 18 }}>
        <button onClick={onClose} aria-label="Tutup" className="btn btn-sm"
          style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: 'none' }}>
          <Ic.x size={16} />Tutup
        </button>
      </div>
      {urls.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setI(p => (p - 1 + urls.length) % urls.length); }}
            aria-label="Sebelumnya"
            style={{
              position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)',
              width: 44, height: 44, borderRadius: 99, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.18)', color: 'white', fontSize: 22, fontWeight: 800,
            }}>‹</button>
          <button onClick={e => { e.stopPropagation(); setI(p => (p + 1) % urls.length); }}
            aria-label="Berikutnya"
            style={{
              position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
              width: 44, height: 44, borderRadius: 99, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.18)', color: 'white', fontSize: 22, fontWeight: 800,
            }}>›</button>
          <div style={{
            position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center',
            color: 'white', fontSize: 13, fontWeight: 600,
          }}>{i + 1} / {urls.length}</div>
        </>
      )}
    </div>
  );
}

function LaporanDetail({ k, onClose, petugasById, nasabahById }: {
  k: Kunjungan; onClose: () => void;
  petugasById: (id: string) => Petugas | undefined;
  nasabahById: (id: string) => Nasabah | undefined;
}) {
  const p = petugasById(k.petugas);
  const n = nasabahById(k.nasabah);
  const role = useAuth(s => s.user?.role);
  const canReview = role === 'SUPERVISOR' || role === 'ADMIN';
  const review = useReviewKunjungan();
  const [note, setNote] = useState(k.reviewNote ?? '');
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  if (!p || !n) return null;
  const h = HASIL_KUNJUNGAN[k.hasil];

  const submitReview = (status: 'APPROVED' | 'REJECTED') => {
    setReviewErr(null);
    review.mutate(
      { id: k.id, status, note: note || undefined },
      {
        onSuccess: () => onClose(),
        onError: (e: any) => {
          if (e?.response?.data?.error === 'already_reviewed') setReviewErr('Laporan ini sudah direview.');
          else setReviewErr('Gagal menyimpan review.');
        },
      },
    );
  };
  return (
    <Modal onClose={onClose} max={620}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="center gap-2"><span className="section-title">Laporan Kunjungan</span>
            <span className="badge" style={{ background: h.soft, color: h.c }}>{h.label}</span></div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{k.id} · {k.jam} · {k.tanggal ? new Date(k.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        <FotoGallery fotos={k.fotos ?? []} nasabahNama={n.nama} canAnnotate={canReview} />


        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', marginBottom: 16 }}>
          <div className="between">
            <div className="center gap-3">
              <Avatar inisial={p.inisial} hue={p.hue} size={40} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{n.nama}</div>
                <div className="muted" style={{ fontSize: 12 }}>Dikunjungi oleh {p.nama}</div>
              </div>
            </div>
            <KolBadge kol={n.kol} full />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <Kv label="Hasil kunjungan" value={h.label} />
          <Kv label="Pembayaran" value={k.nominal > 0 ? RP(k.nominal) : 'Tidak ada'} />
          <Kv label="Tunggakan saat ini" value={k.dpd > 0 ? k.dpd + ' hari' : 'Lancar'} />
          <Kv label="Validasi GPS" value={k.valid ? '✓ Sesuai lokasi nasabah' : '⚠ Di luar radius'} />
        </div>

        {(k.riskFlags?.length ?? 0) > 0 && (
          <div className="card card-pad" style={{
            marginBottom: 16, boxShadow: 'none',
            background: 'var(--col-macet-soft)', border: '1px solid var(--col-macet)',
          }}>
            <div className="center gap-2" style={{ fontWeight: 800, fontSize: 13, color: 'var(--col-macet)', marginBottom: 6 }}>
              <Ic.alert size={15} />Perlu review · skor risiko {k.riskScore ?? 0}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--col-macet)', lineHeight: 1.55 }}>
              {(k.riskFlags ?? []).map(f => {
                const meta = RISK_FLAG_META[f];
                return <li key={f}><strong>{meta?.label ?? f}</strong>{meta ? ` — ${meta.hint}` : null}</li>;
              })}
            </ul>
          </div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6 }}>CATATAN PETUGAS</div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>{k.catatan}</p>

        <div className="card card-pad center gap-3" style={{ marginTop: 16, boxShadow: 'none', background: 'var(--surface-2)', padding: '12px 14px' }}>
          <Ic.location size={18} style={{ color: k.valid ? 'var(--accent)' : 'var(--col-macet)', flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{k.lokasi}</div>
            <div className="muted mono" style={{ fontSize: 11 }}>-6.4{k.id.slice(1)}, 106.8{k.foto}21 · akurasi 8m</div>
          </div>
          {k.valid
            ? <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.checkCircle}>Tervalidasi</Badge>
            : <Badge c="var(--col-macet)" soft="var(--col-macet-soft)" icon={Ic.alert}>Perlu cek</Badge>}
        </div>
      </div>
      {canReview && k.reviewStatus === 'PENDING' && (
        <div style={{ padding: '0 24px 14px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6, marginTop: 8 }}>CATATAN REVIEW (opsional)</div>
          <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Alasan persetujuan / penolakan…" style={{ resize: 'none' }} />
          {reviewErr && (
            <div className="center gap-2" style={{ marginTop: 8, background: 'var(--col-macet-soft)', color: 'var(--col-macet)', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>
              <Ic.alert size={14} />{reviewErr}
            </div>
          )}
        </div>
      )}
      {k.reviewStatus && k.reviewStatus !== 'PENDING' && (
        <div style={{ padding: '0 24px 14px' }}>
          <div className="card card-pad" style={{
            boxShadow: 'none',
            background: k.reviewStatus === 'APPROVED' ? 'var(--accent-soft)' : 'var(--col-macet-soft)',
            border: `1px solid ${k.reviewStatus === 'APPROVED' ? 'var(--accent)' : 'var(--col-macet)'}`,
          }}>
            <div className="between">
              <div className="center gap-2" style={{ fontWeight: 800, fontSize: 13, color: k.reviewStatus === 'APPROVED' ? 'var(--accent-ink)' : 'var(--col-macet)' }}>
                {k.reviewStatus === 'APPROVED' ? <Ic.checkCircle size={15} /> : <Ic.x size={15} />}
                {k.reviewStatus === 'APPROVED' ? 'Disetujui' : 'Ditolak'}
              </div>
              {k.reviewedAt && (
                <span className="muted mono" style={{ fontSize: 11 }}>{new Date(k.reviewedAt).toLocaleString('id-ID')}</span>
              )}
            </div>
            {k.reviewNote && (
              <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-2)' }}>{k.reviewNote}</div>
            )}
          </div>
        </div>
      )}
      <div className="modal-foot">
        {canReview && k.reviewStatus === 'PENDING' ? (
          <>
            <button className="btn" onClick={() => submitReview('REJECTED')} disabled={review.isPending}
              style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none' }}>
              <Ic.x size={15} />Tolak
            </button>
            <button className="btn btn-primary" onClick={() => submitReview('APPROVED')} disabled={review.isPending}>
              <Ic.checkCircle size={15} />Setujui
            </button>
          </>
        ) : (
          <>
            <button className="btn"><Ic.download size={15} />Unduh PDF</button>
            <button className="btn btn-primary"><Ic.phone size={15} />Hubungi {p.nama.split(' ')[0]}</button>
          </>
        )}
      </div>
    </Modal>
  );
}

// "Unduh semua" — downloads a server-streamed zip of PDF for every kunjungan
// in the current scope (optionally filtered by petugasId). The server caps
// at 500 rows; we surface that limit in the button hint via aria-describedby.
function BulkPdfButton({ petugasId }: { petugasId?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true); setErr(null);
    try {
      const qs = petugasId ? `?petugasId=${encodeURIComponent(petugasId)}` : '';
      await downloadAuthed(`/kunjungan/bulk-export.zip${qs}`,
        `laporan-bsn-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e: any) {
      const code = e?.response?.status;
      setErr(code === 404 ? 'Tidak ada laporan pada filter ini.' : 'Gagal mengunduh.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn btn-sm" onClick={onClick} disabled={busy}
        title="Unduh PDF semua laporan pada filter ini (max 500)">
        <Ic.download size={13} />{busy ? 'Mengunduh…' : 'Unduh ZIP PDF'}
      </button>
      {err && <span className="muted" style={{ fontSize: 11, color: 'var(--col-macet)' }}>{err}</span>}
    </>
  );
}

function BulkReviewBar({ allPendingIds, selected, setSelected, note, setNote, busy, err, onApply }: {
  allPendingIds: string[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  note: string;
  setNote: (s: string) => void;
  busy: boolean;
  err: string | null;
  onApply: (status: 'APPROVED' | 'REJECTED') => void;
}) {
  const allSelected = selected.size > 0 && selected.size === allPendingIds.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allPendingIds));
  };
  return (
    <div className="card fade-up" style={{
      marginTop: 12, padding: 12,
      background: selected.size > 0 ? 'var(--accent-soft)' : 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="center gap-2" style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" checked={allSelected}
            ref={el => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
            onChange={toggleAll}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
          {selected.size === 0
            ? `Pilih untuk bulk review (${allPendingIds.length} pending)`
            : `${selected.size} dari ${allPendingIds.length} terpilih`}
        </label>
        {selected.size > 0 && (
          <div className="center gap-2" style={{ flexWrap: 'wrap' }}>
            <input className="input" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Catatan (opsional, dipakai untuk semua)"
              style={{ width: 280 }} />
            <button className="btn" onClick={() => onApply('REJECTED')} disabled={busy}
              style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none' }}>
              <Ic.x size={15} />Tolak {selected.size}
            </button>
            <button className="btn btn-primary" onClick={() => onApply('APPROVED')} disabled={busy}>
              <Ic.checkCircle size={15} />Setujui {selected.size}
            </button>
          </div>
        )}
      </div>
      {err && (
        <div className="center gap-2" style={{
          marginTop: 8, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
          borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600,
        }}>
          <Ic.alert size={14} />{err}
        </div>
      )}
    </div>
  );
}

