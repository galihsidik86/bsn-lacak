-- 2FA TOTP fields on User. Secret stored as AES-GCM ciphertext (hex of
-- iv || tag || ct) so a DB dump alone can't reconstruct shared secrets;
-- needs TOTP_ENCRYPTION_KEY from env to decrypt.

ALTER TABLE "User"
  ADD COLUMN "totpSecret"    TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
