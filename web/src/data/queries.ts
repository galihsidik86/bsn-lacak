import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import * as mock from './mock';
import type {
  BlastEntry, KolKey, Kunjungan, Nasabah, PayflowPoint, Petugas, Postur,
} from '../types';

// ---- Hooks ----
// Each list hook returns a stable `.data` array (empty during load) so the
// existing screens can map over it without null checks. Use `.isPending` /
// `.error` for explicit loading/error states where it matters.

export function usePetugasList() {
  const q = useQuery({ queryKey: ['petugas'], queryFn: () => api.listPetugas() });
  return { ...q, data: q.data ?? ([] as Petugas[]) };
}

export function useNasabahList() {
  const q = useQuery({ queryKey: ['nasabah'], queryFn: () => api.listNasabah() });
  return { ...q, data: q.data ?? ([] as Nasabah[]) };
}

export function useKunjunganList() {
  const q = useQuery({ queryKey: ['kunjungan'], queryFn: () => api.listKunjungan() });
  return { ...q, data: q.data ?? ([] as Kunjungan[]) };
}

export function useBlastHistory() {
  const q = useQuery({ queryKey: ['blast'], queryFn: () => api.listBlast() });
  return { ...q, data: q.data ?? ([] as BlastEntry[]) };
}

export function usePayflow() {
  const q = useQuery({ queryKey: ['payflow'], queryFn: () => api.payflow() });
  return { ...q, data: q.data ?? ([] as PayflowPoint[]) };
}

// ---- Derived (client-side aggregation from the cache) ----

export function usePostur(): Postur {
  const { data } = useNasabahList();
  const out: Postur = { 1: { n: 0, nom: 0 }, 2: { n: 0, nom: 0 }, 3: { n: 0, nom: 0 }, 4: { n: 0, nom: 0 }, 5: { n: 0, nom: 0 } };
  data.forEach(n => { out[n.kol].n++; out[n.kol].nom += n.sisa; });
  return out;
}

export function useTotalOutstanding() {
  const { data } = useNasabahList();
  return data.reduce((s, n) => s + n.sisa, 0);
}

export function useNpl() {
  const postur = usePostur();
  const total = useTotalOutstanding();
  if (!total) return 0;
  return ((postur[3].nom + postur[4].nom + postur[5].nom) / total) * 100;
}

export function useSegmen() {
  const { data } = useNasabahList();
  return {
    h3: data.filter(n => n.kol === (1 as KolKey) && n.dueIn >= 1 && n.dueIn <= 3),
    hari_ini: data.filter(n => n.dueIn === 0),
    lewat: data.filter(n => n.dueIn < 0),
  };
}

export function usePetugasById(id: string): Petugas | undefined {
  const { data } = usePetugasList();
  return data.find(p => p.id === id);
}

export function useNasabahById(id: string): Nasabah | undefined {
  const { data } = useNasabahList();
  return data.find(n => n.id === id);
}

// Closures for inline lookups inside .map / event handlers (where hooks can't go).
// They re-fire when the underlying list changes thanks to useCallback's deps.
export function usePetugasFinder() {
  const { data } = usePetugasList();
  return useCallback((id: string) => data.find(p => p.id === id), [data]);
}

export function useNasabahFinder() {
  const { data } = useNasabahList();
  return useCallback((id: string) => data.find(n => n.id === id), [data]);
}

// ---- Mutations ----

export function useReassign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nasabahId, petugasId }: { nasabahId: string; petugasId: string }) =>
      api.reassign(nasabahId, petugasId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nasabah'] }),
  });
}

export function useSendBlast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.sendBlast,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blast'] }),
  });
}

export function useCreateKunjungan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createKunjungan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kunjungan'] });
      qc.invalidateQueries({ queryKey: ['nasabah'] });
    },
  });
}

export function useReviewKunjungan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'APPROVED' | 'REJECTED'; note?: string }) =>
      api.reviewKunjungan(id, status, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kunjungan'] }),
  });
}

// Combined loading/error flags from the core data the dashboard depends on.
// Screens use these to decide whether to render skeletons or empty states.
export function useDataStatus() {
  const p = usePetugasList();
  const n = useNasabahList();
  const k = useKunjunganList();
  const isPending = p.isPending || n.isPending || k.isPending;
  const isError = !!(p.error || n.error || k.error);
  const isEmpty = !isPending && !isError && p.data.length === 0 && n.data.length === 0;
  return { isPending, isError, isEmpty };
}

// Re-export constants so screens have a single import source.
export const KOL = mock.KOL;
export const STATUS_PETUGAS = mock.STATUS_PETUGAS;
export const HASIL_KUNJUNGAN = mock.HASIL_KUNJUNGAN;
export const TEMPLATES = mock.TEMPLATES;
export const RP = mock.RP;
export const RPjt = mock.RPjt;
