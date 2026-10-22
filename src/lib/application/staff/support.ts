import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
export async function findPayrollPolicy(session: AppSession, clinicId: string | null) {
    const scopeKeys = clinicId ? [clinicId, "all"] : ["all"];
    return prisma.payrollPolicy.findFirst({
        where: {
            organizationId: session.organizationId,
            scopeKey: {
                in: scopeKeys,
            },
            active: true,
        },
        orderBy: {
            clinicId: "desc",
        },
    });
}
export async function staffProfileMap(session: AppSession, userIds: string[]) {
    const profiles = await prisma.staffProfile.findMany({
        where: {
            organizationId: session.organizationId,
            userId: {
                in: userIds,
            },
        },
        select: {
            id: true,
            userId: true,
            employeeCode: true,
            user: {
                select: {
                    role: true,
                },
            },
        },
    });
    return new Map(profiles.map((profile) => [profile.userId, profile]));
}
export function buildWorkdaysByProfile(logs: Array<{
    staffProfileId: string;
    clockInAt: Date;
}>) {
    const byProfile = new Map<string, Set<string>>();
    for (const log of logs) {
        const days = byProfile.get(log.staffProfileId) ?? new Set<string>();
        days.add(vietnamDateKey(log.clockInAt));
        byProfile.set(log.staffProfileId, days);
    }
    return byProfile;
}
export function vietnamDateKey(date: Date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}
export function effectivePayrollPolicyForProfile(policy: Awaited<ReturnType<typeof findPayrollPolicy>>, profile: {
    id: string;
    employeeCode: string;
    user?: {
        role: string;
    };
}, base: {
    insurancePercent: number;
    otherDeductionAmount: number;
    standardWorkdays: number;
    taxPercent: number;
}) {
    const staffOverrides = overrideRecord(policy?.staffOverrides);
    const roleOverrides = overrideRecord(policy?.roleOverrides);
    const roleKey = profile.user?.role ?? "";
    const override = staffOverrides[profile.id] ??
        staffOverrides[profile.employeeCode] ??
        roleOverrides[roleKey] ??
        null;
    if (!override) {
        return {
            ...base,
            source: "base",
        };
    }
    return {
        insurancePercent: overridePercent(override.insurancePercent, base.insurancePercent),
        otherDeductionAmount: overrideMoney(override.otherDeductionAmount, base.otherDeductionAmount),
        standardWorkdays: overrideWorkdays(override.standardWorkdays, base.standardWorkdays),
        taxPercent: overridePercent(override.taxPercent, base.taxPercent),
        source: staffOverrides[profile.id] || staffOverrides[profile.employeeCode]
            ? "staff"
            : "role",
    };
}
export function overrideRecord(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {} as Record<string, Record<string, unknown>>;
    }
    return value as Record<string, Record<string, unknown>>;
}
export function overridePercent(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.min(parsed, 100);
}
export function overrideMoney(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}
export function overrideWorkdays(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.max(Math.floor(parsed), 1);
}
export function proratedBaseSalary(monthlyBaseSalary: number, workedDays: number, standardWorkdays: number) {
    if (monthlyBaseSalary <= 0 || standardWorkdays <= 0) {
        return 0;
    }
    return Math.round((monthlyBaseSalary / standardWorkdays) *
        Math.min(Math.max(workedDays, 0), standardWorkdays));
}
export function nullableJson(value: Prisma.InputJsonObject | null) {
    return value ?? Prisma.JsonNull;
}
export function parsePayrollPolicyCsv(csvText: string) {
    const lines = csvText
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const [headerLine, ...dataLines] = lines;
    if (!headerLine) {
        return [];
    }
    const headers = splitCsvLine(headerLine).map((header) => header.trim().toLowerCase());
    return dataLines.map((line) => {
        const cells = splitCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
            row[header] = cells[index] ?? "";
        });
        return row;
    });
}
export function splitCsvLine(line: string) {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
            current += '"';
            index += 1;
            continue;
        }
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (char === "," && !quoted) {
            cells.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    cells.push(current);
    return cells;
}
export function positiveInteger(value: (string | File) | null, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.max(Math.floor(parsed), 1);
}
export function percentageInput(value: (string | File) | null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Math.min(parsed, 100);
}
export function parseOverridesJson(value: (string | File) | string | null) {
    const text = String(value ?? "").trim();
    if (!text) {
        return null;
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Prisma.InputJsonObject)
            : false;
    }
    catch {
        return false;
    }
}
export function parseBoolean(value: string | undefined, fallback: boolean) {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) {
        return fallback;
    }
    return ["true", "1", "yes", "y", "on"].includes(normalized);
}
export async function scopedStaffProfile(session: AppSession, staffProfileId: string) {
    if (!staffProfileId) {
        return null;
    }
    return prisma.staffProfile.findFirst({
        where: {
            id: staffProfileId,
            organizationId: session.organizationId,
            OR: [
                {
                    clinicId: {
                        in: allowedClinicIdsFor(session),
                    },
                },
                {
                    clinicId: null,
                },
            ],
        },
        select: {
            id: true,
            clinicId: true,
        },
    });
}
export function vietnamStartOfToday() {
    return new Date(`${vietnamDateKey(new Date())}T00:00:00+07:00`);
}
export async function scopedPayrollRun(session: AppSession, payrollRunId: string) {
    if (!payrollRunId) {
        return null;
    }
    return prisma.payrollRun.findFirst({
        where: {
            id: payrollRunId,
            organizationId: session.organizationId,
            OR: [
                {
                    clinicId: {
                        in: allowedClinicIdsFor(session),
                    },
                },
                {
                    clinicId: null,
                },
            ],
        },
        include: {
            lines: {
                select: {
                    id: true,
                },
            },
        },
    });
}
export function optionalPositiveInteger(value: (string | File) | null) {
    if (value == null || String(value).trim() === "") {
        return null;
    }
    return positiveInteger(value, 26);
}
export function optionalPercentageInput(value: (string | File) | null) {
    if (value == null || String(value).trim() === "") {
        return null;
    }
    return percentageInput(value);
}
