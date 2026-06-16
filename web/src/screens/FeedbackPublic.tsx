import { useEffect, useState } from 'react';
import axios from 'axios';
import { Ic } from '../components/Icons';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface FeedbackInfo {
  nasabahNama: string;
  petugasNama: string;
  petugasKode: string;
  branchNama: string;
  visitDate: string;
  visitHasil: string;
  rating: number | null;
  comment: string | null;
  repliedAt: string | null;
}

// Public, no-auth page rendered when the location hash matches
// "feedback/<token>". The nasabah opens it from an SMS link, picks a star
// rating + optional comment, and submits. Once submitted, the same token
// becomes read-only.

export function ScreenFeedbackPublic({ token }: { token: string }) {
  const [info, setInfo] = useState<FeedbackInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${BASE}/feedback/${token}`);
        setInfo(r.data);
        if (r.data.repliedAt) {
          setRating(r.data.rating ?? 0);
          setComment(r.data.comment ?? '');
          setDone(true);
        }
      } catch (e: any) {
        if (e?.response?.status === 404) setErr('Link feedback tidak valid atau sudah kedaluwarsa.');
        else setErr('Gagal memuat. Coba lagi.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const submit = async () => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      await axios.post(`${BASE}/feedback/${token}`, { rating, comment: comment || undefined });
      setDone(true);
    } catch (e: any) {
      if (e?.response?.data?.error === 'already_submitted') {
        setErr('Penilaian sudah pernah dikirim.');
        setDone(true);
      } else {
        setErr('Gagal mengirim. Coba lagi.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(160deg, var(--bg) 0%, var(--accent-soft) 100%)',
      display: 'grid', placeItems: 'center', padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
        <div className="center gap-3" style={{ marginBottom: 16 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, flex: 'none',
            background: 'linear-gradient(150deg, var(--accent), var(--accent-700))',
            display: 'grid', placeItems: 'center',
          }}>
            <Ic.checkCircle size={22} style={{ color: 'white' }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>BSN Lacak</div>
            <div className="muted" style={{ fontSize: 12 }}>Penilaian layanan petugas</div>
          </div>
        </div>

        {loading && (
          <div className="muted" style={{ textAlign: 'center', padding: 24 }}>Memuat…</div>
        )}

        {err && !info && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '12px 14px', fontSize: 13, fontWeight: 600,
          }}>
            <Ic.alert size={16} />{err}
          </div>
        )}

        {info && (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 6px' }}>
              Halo {info.nasabahNama},
            </h1>
            <p className="muted" style={{ fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.6 }}>
              Mohon beri penilaian untuk layanan petugas <strong>{info.petugasNama}</strong>
              {' '}dari {info.branchNama} yang mengunjungi Anda pada{' '}
              <strong>{new Date(info.visitDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>.
            </p>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>
                Berikan rating
              </div>
              <div className="center" style={{ gap: 4 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => !done && setRating(n)} disabled={done}
                    aria-label={`${n} bintang`}
                    style={{
                      background: 'transparent', border: 'none', cursor: done ? 'default' : 'pointer',
                      padding: 4, fontSize: 36, lineHeight: 1,
                      color: n <= rating ? '#f5b81f' : 'var(--ink-4)',
                    }}>★</button>
                ))}
              </div>
              <div className="muted" style={{ textAlign: 'center', fontSize: 11.5, marginTop: 4 }}>
                {rating === 0 ? 'Pilih 1–5 bintang'
                  : rating === 1 ? 'Sangat buruk'
                  : rating === 2 ? 'Buruk'
                  : rating === 3 ? 'Cukup'
                  : rating === 4 ? 'Bagus'
                  : 'Sangat bagus'}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 6 }}>
                Komentar (opsional)
              </div>
              <textarea className="input" rows={3} value={comment}
                onChange={e => setComment(e.target.value)}
                disabled={done}
                maxLength={2000}
                placeholder="Layanan sopan, tepat waktu, dll."
                style={{ resize: 'vertical' }} />
            </div>

            {err && (
              <div className="center gap-2" style={{
                background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
                marginBottom: 12,
              }}>
                <Ic.alert size={15} />{err}
              </div>
            )}

            {done ? (
              <div className="center gap-2" style={{
                background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                borderRadius: 10, padding: '12px 14px', fontSize: 13, fontWeight: 700,
              }}>
                <Ic.checkCircle size={16} />Terima kasih, penilaian Anda sudah dikirim.
              </div>
            ) : (
              <button onClick={submit} disabled={rating < 1 || submitting}
                className="btn btn-primary" style={{ width: '100%', padding: '12px 14px', fontSize: 14 }}>
                {submitting ? 'Mengirim…' : 'Kirim Penilaian'}
              </button>
            )}

            <div className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 14 }}>
              Penilaian Anda membantu kami menjaga kualitas layanan.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
