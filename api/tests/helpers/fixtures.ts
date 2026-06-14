import bcrypt from 'bcryptjs';
import { Role, type PrismaClient } from '@prisma/client';

const STRONG_PW = 'Aaa1!Aaa1!Aaa1!Aaa1!';     // passes policy

export interface SeedOut {
  branchAId: string;
  branchBId: string;
  // Branch A users
  supervisorAId: string;
  supervisorAUsername: string;
  petugasUserAId: string;
  petugasAUsername: string;
  petugasAId: string;
  otherPetugasAId: string;
  // Branch B users
  supervisorBId: string;
  supervisorBUsername: string;
  petugasBId: string;
  // HQ admin
  adminId: string;
  adminUsername: string;
  password: string;

  // back-compat aliases for existing auth.test.ts + authz.test.ts
  supervisorId: string;
  supervisorUsername: string;
  petugasUserId: string;
  petugasUsername: string;
  petugasId: string;
  otherPetugasId: string;
}

export async function seedBasic(prisma: PrismaClient): Promise<SeedOut> {
  const hash = await bcrypt.hash(STRONG_PW, 4);

  const branchA = await prisma.branch.create({
    data: { kode: 'TST001', nama: 'Test Cabang A', alamat: 'Test Jl. A' },
  });
  const branchB = await prisma.branch.create({
    data: { kode: 'TST002', nama: 'Test Cabang B', alamat: 'Test Jl. B' },
  });

  // Branch A: pet1 + pet2
  const pet1 = await prisma.petugas.create({
    data: { kode: 'PT1', nama: 'Test Petugas Satu', inisial: 'P1', wilayah: 'Wilayah A', hp: '0811', target: 1_000_000n, hue: 156, branchId: branchA.id },
  });
  const pet2 = await prisma.petugas.create({
    data: { kode: 'PT2', nama: 'Test Petugas Dua',  inisial: 'P2', wilayah: 'Wilayah A2', hp: '0812', target: 1_000_000n, hue: 200, branchId: branchA.id },
  });
  // Branch B: pet3
  const pet3 = await prisma.petugas.create({
    data: { kode: 'PT3', nama: 'Test Petugas Tiga', inisial: 'P3', wilayah: 'Wilayah B', hp: '0813', target: 1_000_000n, hue: 60, branchId: branchB.id },
  });

  // Branch A users
  const supA = await prisma.user.create({
    data: { username: 'supA', passwordHash: hash, nama: 'Sup A', role: Role.SUPERVISOR, branchId: branchA.id },
  });
  const puA = await prisma.user.create({
    data: { username: 'petA', passwordHash: hash, nama: 'Petugas A', role: Role.PETUGAS, petugasId: pet1.id, branchId: branchA.id },
  });

  // Branch B users
  const supB = await prisma.user.create({
    data: { username: 'supB', passwordHash: hash, nama: 'Sup B', role: Role.SUPERVISOR, branchId: branchB.id },
  });

  // HQ admin (no branch)
  const admin = await prisma.user.create({
    data: { username: 'admin1', passwordHash: hash, nama: 'Admin HQ', role: Role.ADMIN },
  });

  await prisma.nasabah.createMany({
    data: [
      { kode: 'N0001', nama: 'Nasabah A1', alamat: 'Jl. A', hp: '08111', petugasId: pet1.id, branchId: branchA.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 500_000n, dueIn: 5, lat: -6.4825, lng: 106.8595 },
      { kode: 'N0002', nama: 'Nasabah A2', alamat: 'Jl. B', hp: '08112', petugasId: pet1.id, branchId: branchA.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 600_000n, dueIn: -10, dpd: 10, lat: -6.4825, lng: 106.8595 },
      { kode: 'N0003', nama: 'Nasabah A3', alamat: 'Jl. C', hp: '08113', petugasId: pet2.id, branchId: branchA.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 700_000n, dueIn: 2 },
      { kode: 'N0004', nama: 'Nasabah B1', alamat: 'Jl. D', hp: '08114', petugasId: pet3.id, branchId: branchB.id, plafon: 1_000_000n, tenor: 12, angsuran: 100_000n, sisa: 800_000n, dueIn: 3 },
    ],
  });

  return {
    branchAId: branchA.id, branchBId: branchB.id,
    supervisorAId: supA.id, supervisorAUsername: 'supA',
    petugasUserAId: puA.id, petugasAUsername: 'petA',
    petugasAId: pet1.id, otherPetugasAId: pet2.id,
    supervisorBId: supB.id, supervisorBUsername: 'supB',
    petugasBId: pet3.id,
    adminId: admin.id, adminUsername: 'admin1',
    password: STRONG_PW,
    // back-compat aliases
    supervisorId: supA.id, supervisorUsername: 'supA',
    petugasUserId: puA.id, petugasUsername: 'petA',
    petugasId: pet1.id, otherPetugasId: pet2.id,
  };
}
