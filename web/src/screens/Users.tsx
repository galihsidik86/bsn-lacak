import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Badge, Modal } from '../components/UI';
import { tokenStore } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Branch { id: string; kode: string; nama: string; active: boolean }
interface Petugas { id: string; kode: string; nama: string; branchId: string }

interface UserRow {
  id: string;
  username: string;
  nama: string;
  role: Role;
  branchId: string | null;
  petugasId: string | null;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  branch: { kode: string; nama: string } | null;
  petugas: { kode: string; nama: string } | null;
}

function authHeaders() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

async function listUsers(): Promise<UserRow[]> {
  return (await axios.get(`${BASE}/users`, { withCredentials: true, headers: authHeaders() })).data;
}
async function listBranchesAll(): Promise<Branch[]> {
  return (await axios.get(`${BASE}/branches`, { withCredentials: true, headers: authHeaders() })).data;
}
async function listPetugasAll(): Promise<Petugas[]> {
  return (await axios.get(`${BASE}/petugas`, { withCredentials: true, headers: authHeaders() })).data;
}

interface CreatePayload {
  username: string;
  nama: string;
  role: Role;
  branchId: string | null;
  petugasId: string | null;
}

async function createUser(p: CreatePayload): Promise<{ id: string; tempPassword: string; username: string; nama: string }> {
  return (await axios.post(`${BASE}/users`, p, { withCredentials: true, headers: authHeaders() })).data;
}
async function patchUser(id: string, p: Partial<{ nama: string; role: Role; branchId: string | null; active: boolean }>) {
  return (await axios.patch(`${BASE}/users/${id}`, p, { withCredentials: true, headers: authHeaders() })).data;
}
async function resetPassword(id: string): Promise<{ tempPassword: string }> {
  return (await axios.post(`${BASE}/users/${id}/reset-password`, {}, { withCredentials: true, headers: authHeaders() })).data;
}

export function ScreenUsers() {
  const me = useAuth(s => s.user);
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: listBranchesAll });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(null);

  if (usersQ.isPending) return <div className="content" style={{ display: 'grid', gap: 16 }}><Skeleton h={80} /><Skeleton h={400} /></div>;
  if (usersQ.error) return <div className="content"><ErrorState onRetry={() => usersQ.refetch()} /></div>;

  const items = usersQ.data ?? [];
  const isAdmin = me?.role === 'ADMIN';

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18 }}>
        <div className="chip"><Ic.users size={14} />{items.length} user · {items.filter(u => u.active).length} aktif</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Tambah User
        </button>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        {items.length === 0 ? (
          <EmptyState title="Belum ada user" hint="Tambahkan user pertama dengan tombol di atas." />
        ) : (
          <table className="table">
            <thead><tr>
              <th>Username</th><th>Nama</th><th>Role</th><th>Cabang</th>
              <th>Petugas Terkait</th><th>Login Terakhir</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {items.map(u => (
                <tr key={u.id}>
                  <td className="mono">{u.username}</td>
                  <td><div style={{ fontWeight: 700 }}>{u.nama}</div></td>
                  <td>
                    <span className="badge" style={{
                      background: u.role === 'ADMIN' ? 'var(--gold-soft)' : 'var(--surface-2)',
                      color: u.role === 'ADMIN' ? 'var(--gold-ink)' : 'var(--ink-2)',
                    }}>{u.role}</span>
                  </td>
                  <td>{u.branch?.nama ?? <span className="muted">— (HQ)</span>}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{u.petugas?.kode ?? <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID') : 'belum pernah'}</td>
                  <td>
                    {u.active
                      ? u.mustChangePassword
                        ? <Badge c="var(--col-dpk)" soft="var(--col-dpk-soft)" icon={Ic.alert}>Ganti pwd</Badge>
                        : <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.checkCircle}>Aktif</Badge>
                      : <Badge c="var(--ink-3)" soft="var(--surface-2)" icon={Ic.x}>Nonaktif</Badge>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)}>
                      <Ic.settings size={14} />Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <UserCreateForm
          isAdmin={isAdmin}
          myBranchId={me?.branchId ?? null}
          branches={branchesQ.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setTempPassword({ username: r.username, password: r.tempPassword });
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {editing && (
        <UserEditForm
          user={editing}
          isAdmin={isAdmin}
          branches={branchesQ.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['users'] }); }}
          onResetPwd={(pwd) => setTempPassword({ username: editing.username, password: pwd })}
        />
      )}

      {tempPassword && (
        <TempPasswordModal
          username={tempPassword.username}
          password={tempPassword.password}
          onClose={() => setTempPassword(null)}
        />
      )}
    </div>
  );
}

function UserCreateForm({ isAdmin, myBranchId, branches, onClose, onCreated }: {
  isAdmin: boolean;
  myBranchId: string | null;
  branches: Branch[];
  onClose: () => void;
  onCreated: (r: { username: string; tempPassword: string }) => void;
}) {
  const [username, setUsername] = useState('');
  const [nama, setNama] = useState('');
  const [role, setRole] = useState<Role>('PETUGAS');
  const [branchId, setBranchId] = useState<string | null>(isAdmin ? null : myBranchId);
  const [petugasId, setPetugasId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const petugasQ = useQuery({
    queryKey: ['petugas-all-' + (branchId ?? 'none')],
    queryFn: listPetugasAll,
    enabled: role === 'PETUGAS',
  });
  const eligiblePetugas = (petugasQ.data ?? []).filter(p => !branchId || p.branchId === branchId);

  const create = useMutation({
    mutationFn: () => createUser({
      username, nama, role,
      branchId: role === 'ADMIN' ? null : branchId,
      petugasId: role === 'PETUGAS' ? petugasId : null,
    }),
    onSuccess: (r) => onCreated({ username: r.username, tempPassword: r.tempPassword }),
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'username_taken') setErr('Username sudah dipakai.');
      else if (c === 'petugas_already_linked') setErr('Petugas ini sudah memiliki user.');
      else if (c === 'petugas_branch_mismatch') setErr('Petugas tidak berada di cabang yang dipilih.');
      else if (c === 'admin_must_be_branchless') setErr('Role ADMIN tidak boleh terikat ke cabang.');
      else if (c === 'branch_required') setErr('SUPERVISOR/PETUGAS wajib pilih cabang.');
      else if (c === 'bad_request') setErr('Format tidak valid. Username harus huruf kecil/angka.');
      else if (c === 'forbidden') setErr('Anda tidak punya wewenang membuat user dengan role/cabang itu.');
      else setErr('Gagal menyimpan. Coba lagi.');
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); create.mutate(); };

  const canSubmit = !!username && !!nama
    && (role === 'ADMIN' || branchId)
    && (role !== 'PETUGAS' || petugasId);

  return (
    <Modal onClose={onClose} max={520}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="section-title">Tambah User</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Password sementara akan ditampilkan sekali.</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Username">
            <input className="input" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} pattern="[a-z0-9_]+" required maxLength={64} placeholder="cthsupervisor_jkt" />
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Huruf kecil, angka, garis bawah. Tidak bisa diubah.</div>
          </Field>
          <Field label="Nama Lengkap">
            <input className="input" value={nama} onChange={e => setNama(e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Role">
            <select className="input" value={role} onChange={e => { const r = e.target.value as Role; setRole(r); if (r === 'ADMIN') setBranchId(null); setPetugasId(null); }}>
              {isAdmin && <option value="ADMIN">ADMIN (HQ — semua cabang)</option>}
              {isAdmin && <option value="SUPERVISOR">SUPERVISOR (kepala cabang)</option>}
              <option value="PETUGAS">PETUGAS (kolektor lapangan)</option>
            </select>
          </Field>
          {role !== 'ADMIN' && (
            <Field label="Cabang">
              <select className="input" value={branchId ?? ''} onChange={e => setBranchId(e.target.value || null)} disabled={!isAdmin} required>
                <option value="">-- pilih cabang --</option>
                {branches.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.kode} · {b.nama}</option>)}
              </select>
              {!isAdmin && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>SUPERVISOR hanya bisa menambah user di cabangnya sendiri.</div>}
            </Field>
          )}
          {role === 'PETUGAS' && (
            <Field label="Petugas yang dihubungkan">
              <select className="input" value={petugasId ?? ''} onChange={e => setPetugasId(e.target.value || null)} required disabled={!branchId}>
                <option value="">-- pilih petugas --</option>
                {eligiblePetugas.map(p => <option key={p.id} value={p.id}>{p.kode} · {p.nama}</option>)}
              </select>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Pilih petugas dulu dari menu Petugas kalau belum ada.</div>
            </Field>
          )}

          {err && (
            <div className="center gap-2" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600 }}>
              <Ic.alert size={15} />{err}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Menyimpan…' : 'Buat User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UserEditForm({ user, isAdmin, branches, onClose, onSaved, onResetPwd }: {
  user: UserRow;
  isAdmin: boolean;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
  onResetPwd: (pwd: string) => void;
}) {
  const [nama, setNama] = useState(user.nama);
  const [role, setRole] = useState<Role>(user.role);
  const [branchId, setBranchId] = useState<string | null>(user.branchId);
  const [active, setActive] = useState(user.active);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => patchUser(user.id, { nama, role, branchId: role === 'ADMIN' ? null : branchId, active }),
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.error ?? 'Gagal menyimpan.'),
  });
  const reset = useMutation({
    mutationFn: () => resetPassword(user.id),
    onSuccess: (r) => { onResetPwd(r.tempPassword); onClose(); },
    onError: () => setErr('Reset password gagal.'),
  });

  return (
    <Modal onClose={onClose} max={520}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Edit User</div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{user.username}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>

      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Nama Lengkap">
          <input className="input" value={nama} onChange={e => setNama(e.target.value)} maxLength={200} />
        </Field>
        {isAdmin && (
          <Field label="Role">
            <select className="input" value={role} onChange={e => { const r = e.target.value as Role; setRole(r); if (r === 'ADMIN') setBranchId(null); }}>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERVISOR">SUPERVISOR</option>
              <option value="PETUGAS">PETUGAS</option>
            </select>
          </Field>
        )}
        {role !== 'ADMIN' && (
          <Field label="Cabang">
            <select className="input" value={branchId ?? ''} onChange={e => setBranchId(e.target.value || null)} disabled={!isAdmin}>
              <option value="">-- pilih cabang --</option>
              {branches.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.kode} · {b.nama}</option>)}
            </select>
          </Field>
        )}
        <label className="center gap-2" style={{ fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Akun aktif (uncheck untuk nonaktifkan + revoke sesi)
        </label>

        {err && (
          <div className="center gap-2" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600 }}>
            <Ic.alert size={15} />{err}
          </div>
        )}
      </div>

      <div className="modal-foot">
        <button type="button" className="btn"
          style={{ marginRight: 'auto' }}
          onClick={() => { if (confirm(`Reset password untuk ${user.username}?`)) reset.mutate(); }}
          disabled={reset.isPending || save.isPending}>
          {reset.isPending ? 'Mereset…' : 'Reset Password'}
        </button>
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button type="button" className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </Modal>
  );
}

function TempPasswordModal({ username, password, onClose }: {
  username: string; password: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* ignore */ }
  };
  return (
    <Modal onClose={onClose} max={460}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Password Sementara</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Untuk <span className="mono">{username}</span></div>
        </div>
      </div>
      <div className="modal-body">
        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', textAlign: 'center', marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.04em', wordBreak: 'break-all' }}>{password}</div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={copy}>
            <Ic.download size={13} />{copied ? 'Tersalin!' : 'Salin ke clipboard'}
          </button>
        </div>
        <div className="card card-pad center gap-3" style={{ background: 'var(--col-dpk-soft)', boxShadow: 'none', padding: 12 }}>
          <Ic.alert size={18} style={{ color: 'var(--col-dpk)', flex: 'none' }} />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Password ini hanya tampil sekali. Catat sekarang dan serahkan ke user. Mereka harus ganti password di login pertama.
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-primary" onClick={onClose} style={{ marginLeft: 'auto' }}>
          Sudah saya catat
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
