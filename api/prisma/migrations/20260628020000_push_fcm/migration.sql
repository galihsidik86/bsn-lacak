-- Tambah kolom kind (vapid|fcm) + bikin p256dh/authKey nullable supaya
-- FCM token (tanpa public key) bisa di-store di table yang sama.
ALTER TABLE "PushSubscription" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'vapid';
ALTER TABLE "PushSubscription" ALTER COLUMN "p256dh" DROP NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "authKey" DROP NOT NULL;
CREATE INDEX "PushSubscription_kind_idx" ON "PushSubscription"("kind");
