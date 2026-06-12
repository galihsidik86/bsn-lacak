-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERVISOR', 'PETUGAS', 'ADMIN');

-- CreateEnum
CREATE TYPE "PetugasStatus" AS ENUM ('LAPANGAN', 'ISTIRAHAT', 'KANTOR');

-- CreateEnum
CREATE TYPE "KolKey" AS ENUM ('K1', 'K2', 'K3', 'K4', 'K5');

-- CreateEnum
CREATE TYPE "Akad" AS ENUM ('MURABAHAH', 'MUSYARAKAH', 'IJARAH', 'MUSYARAKAH_MUTANAQISAH', 'ISTISHNA');

-- CreateEnum
CREATE TYPE "HasilKunjungan" AS ENUM ('BAYAR', 'JANJI', 'TIDAKADA', 'TOLAK');

-- CreateEnum
CREATE TYPE "BlastChannel" AS ENUM ('WA', 'SMS');

-- CreateEnum
CREATE TYPE "BlastStatus" AS ENUM ('TERJADWAL', 'BERJALAN', 'SELESAI', 'GAGAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "petugasId" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "parentId" TEXT,
    "family" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Petugas" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "inisial" TEXT NOT NULL,
    "wilayah" TEXT NOT NULL,
    "hp" TEXT NOT NULL,
    "status" "PetugasStatus" NOT NULL DEFAULT 'LAPANGAN',
    "target" BIGINT NOT NULL DEFAULT 0,
    "hue" INTEGER NOT NULL DEFAULT 156,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Petugas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetugasPosition" (
    "id" TEXT NOT NULL,
    "petugasId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetugasPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nasabah" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT NOT NULL,
    "hp" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "kol" "KolKey" NOT NULL DEFAULT 'K1',
    "akad" "Akad" NOT NULL DEFAULT 'MURABAHAH',
    "plafon" BIGINT NOT NULL,
    "tenor" INTEGER NOT NULL,
    "angsuran" BIGINT NOT NULL,
    "sisa" BIGINT NOT NULL,
    "dpd" INTEGER NOT NULL DEFAULT 0,
    "dueIn" INTEGER NOT NULL DEFAULT 0,
    "lastBayar" TEXT,
    "petugasId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nasabah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kunjungan" (
    "id" TEXT NOT NULL,
    "petugasId" TEXT NOT NULL,
    "nasabahId" TEXT NOT NULL,
    "hasil" "HasilKunjungan" NOT NULL,
    "nominal" BIGINT NOT NULL DEFAULT 0,
    "catatan" TEXT NOT NULL,
    "lokasi" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "jam" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kunjungan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Foto" (
    "id" TEXT NOT NULL,
    "kunjunganId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pembayaran" (
    "id" TEXT NOT NULL,
    "nasabahId" TEXT NOT NULL,
    "nominal" BIGINT NOT NULL,
    "metode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'berhasil',
    "jam" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blast" (
    "id" TEXT NOT NULL,
    "judul" TEXT NOT NULL,
    "kanal" "BlastChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "status" "BlastStatus" NOT NULL DEFAULT 'TERJADWAL',
    "target" INTEGER NOT NULL DEFAULT 0,
    "terkirim" INTEGER NOT NULL DEFAULT 0,
    "dibaca" INTEGER,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlastRecipient" (
    "id" TEXT NOT NULL,
    "blastId" TEXT NOT NULL,
    "nasabahId" TEXT NOT NULL,
    "hp" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BlastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_petugasId_key" ON "User"("petugasId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Petugas_kode_key" ON "Petugas"("kode");

-- CreateIndex
CREATE INDEX "PetugasPosition_petugasId_recordedAt_idx" ON "PetugasPosition"("petugasId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Nasabah_kode_key" ON "Nasabah"("kode");

-- CreateIndex
CREATE INDEX "Nasabah_petugasId_idx" ON "Nasabah"("petugasId");

-- CreateIndex
CREATE INDEX "Nasabah_kol_idx" ON "Nasabah"("kol");

-- CreateIndex
CREATE INDEX "Kunjungan_petugasId_tanggal_idx" ON "Kunjungan"("petugasId", "tanggal");

-- CreateIndex
CREATE INDEX "Kunjungan_nasabahId_tanggal_idx" ON "Kunjungan"("nasabahId", "tanggal");

-- CreateIndex
CREATE INDEX "Pembayaran_nasabahId_tanggal_idx" ON "Pembayaran"("nasabahId", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "BlastRecipient_blastId_nasabahId_key" ON "BlastRecipient"("blastId", "nasabahId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_petugasId_fkey" FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetugasPosition" ADD CONSTRAINT "PetugasPosition_petugasId_fkey" FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nasabah" ADD CONSTRAINT "Nasabah_petugasId_fkey" FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kunjungan" ADD CONSTRAINT "Kunjungan_petugasId_fkey" FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kunjungan" ADD CONSTRAINT "Kunjungan_nasabahId_fkey" FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_kunjunganId_fkey" FOREIGN KEY ("kunjunganId") REFERENCES "Kunjungan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pembayaran" ADD CONSTRAINT "Pembayaran_nasabahId_fkey" FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlastRecipient" ADD CONSTRAINT "BlastRecipient_blastId_fkey" FOREIGN KEY ("blastId") REFERENCES "Blast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlastRecipient" ADD CONSTRAINT "BlastRecipient_nasabahId_fkey" FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

