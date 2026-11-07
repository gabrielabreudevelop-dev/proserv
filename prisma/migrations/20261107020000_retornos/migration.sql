-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDENTE', 'AGENDADO', 'REALIZADO', 'ENCERRADO');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "returnAfterMonths" INTEGER,
ADD COLUMN     "returnServiceId" TEXT;

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDENTE',
    "sourceAppointmentId" TEXT,
    "appointmentId" TEXT,
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpContact" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_appointmentId_key" ON "FollowUp"("appointmentId");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueOn_idx" ON "FollowUp"("status", "dueOn");

-- CreateIndex
CREATE INDEX "FollowUp_customerId_status_idx" ON "FollowUp"("customerId", "status");

-- CreateIndex
CREATE INDEX "FollowUpContact_followUpId_createdAt_idx" ON "FollowUpContact"("followUpId", "createdAt");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_returnServiceId_fkey" FOREIGN KEY ("returnServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sourceAppointmentId_fkey" FOREIGN KEY ("sourceAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpContact" ADD CONSTRAINT "FollowUpContact_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpContact" ADD CONSTRAINT "FollowUpContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

