import bcrypt from 'bcryptjs';
import { Role, type PrismaClient } from '@prisma/client';

const STRONG_PW = 'Aaa1!Aaa1!Aaa1!Aaa1!';     // passes policy
const SUPERVISOR_USER = 'supervisor_test';
const PETUGAS_USER = 'petugas_test';

export interface SeedOut {
  supervisorId: string;
  petugasUserId: string;
  petugasId: string;
  otherPetugasId: string;
  password: string;
  supervisorUsername: string;
  petugasUsername: string;
}

export async function seedBasic(prisma: PrismaClient): Promise<SeedOut> {
  const hash = await bcrypt.hash(STRONG_PW, 4);   // low cost for tests

  const pet1 = await prisma.petugas.create({
    data: { kode: 'PT1', nama: 'Test Petugas Satu', inisial: 'P1', wilayah: 'Wilayah A', hp: '0811', target: 1_000_000n, hue: 156 },
  });
  const pet2 = await prisma.petugas.create({
    data: { kode: 'PT2', nama: 'Test Petugas Dua',  inisial: 'P2', wilayah: 'Wilayah B', hp: '0812', target: 1_000_000n, hue: 200 },
  });

  const sup = await prisma.user.create({
    data: { username: SUPERVISOR_USER, passwordHash: hash, nama: 'Supervisor', role: Role.SUPERVISOR },
  });
  const pu = await prisma.user.create({
    data: { username: PETUGAS_USER, passwordHash: hash, nama: 'Petugas', role: Role.PETUGAS, petugasId: pet1.id },
  });

  await prisma.nasabah.createMany({
    data: [
      { kode: 'N0001', nama: 'Nasabah pet1 A', alamat: 'Jl. A', hp: '08111', petugasId: pet1.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 500_000n, dueIn: 5 },
      { kode: 'N0002', nama: 'Nasabah pet1 B', alamat: 'Jl. B', hp: '08112', petugasId: pet1.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 600_000n, dueIn: -10, dpd: 10 },
      { kode: 'N0003', nama: 'Nasabah pet2 C', alamat: 'Jl. C', hp: '08113', petugasId: pet2.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 700_000n, dueIn: 2 },
    ],
  });

  return {
    supervisorId: sup.id, petugasUserId: pu.id,
    petugasId: pet1.id, otherPetugasId: pet2.id,
    password: STRONG_PW,
    supervisorUsername: SUPERVISOR_USER, petugasUsername: PETUGAS_USER,
  };
}
