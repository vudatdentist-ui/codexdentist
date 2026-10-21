-- Additive state: a committed claim prevents overlapping delivery workers.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
