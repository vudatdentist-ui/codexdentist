-- AlterTable
ALTER TABLE "PatientFile" ADD COLUMN     "checksumSha256" TEXT,
ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "storageProvider" TEXT,
ADD COLUMN     "virusScanStatus" TEXT NOT NULL DEFAULT 'NOT_SCANNED';
