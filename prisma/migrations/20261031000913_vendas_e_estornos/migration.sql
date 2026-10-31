-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "reversesId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversesId_key" ON "LedgerEntry"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerEntry_saleId_idx" ON "LedgerEntry"("saleId");

-- CreateIndex
CREATE INDEX "Sale_sellerId_createdAt_idx" ON "Sale"("sellerId", "createdAt");

