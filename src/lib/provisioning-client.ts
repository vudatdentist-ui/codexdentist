import type { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";

export type ProvisioningClient = Prisma.TransactionClient | typeof prisma;
