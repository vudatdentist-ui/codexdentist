import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId } from "@/lib/form-validation";
import { isUploadedPatientFile, storeStaffProfileUpload, } from "@/lib/patient-file-storage";
import { canUseAllClinics, } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, defaultEmployeeCode, findActiveScopedClinic, } from "@/lib/application/settings/support";
export async function updateStaffProfileCommand(input: {
    userId: string;
    session: AppSession;
    employeeCodeInput: string | null;
    avatarFile: (string | File) | null;
    clinicId: string | null;
    baseSalary: string | false | null;
    hireDate: false | Date | null;
    dateOfBirth: false | Date | null;
    title: string | null;
    department: string | null;
    contractType: string;
    gender: string | null;
    fullName: string;
    phone: string | null;
}) {
    const { userId, session, employeeCodeInput, avatarFile, clinicId, baseSalary, hireDate, dateOfBirth, title, department, contractType, gender, fullName, phone } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!userId || !fullName) {
        failCommand("settings-profile-missing-fields");
    }
    if (clinicId && !canUseAllClinics(session) && !accessibleClinicIds(session).includes(clinicId)) {
        failCommand("settings-user-not-found");
    }
    if (clinicId) {
        const scopedClinic = await findActiveScopedClinic(session, clinicId);
        if (!scopedClinic) {
            failCommand("settings-clinic-inactive");
        }
    }
    if (hireDate === false || dateOfBirth === false) {
        failCommand("settings-profile-bad-date");
    }
    if (baseSalary === false) {
        failCommand("settings-profile-bad-number");
    }
    if (isUploadedPatientFile(avatarFile)) {
        if (!avatarFile.type.startsWith("image/") || avatarFile.type === "image/svg+xml") {
            failCommand("settings-profile-bad-avatar");
        }
        if (avatarFile.size > 5 * 1024 * 1024) {
            failCommand("settings-profile-avatar-large");
        }
    }
    let notice: string | null = null;
    const user = await prisma.user.findFirst({
        where: {
            id: userId,
            organizationId: session.organizationId,
            clinics: {
                some: {
                    clinicId: {
                        in: accessibleClinicIds(session),
                    },
                },
            },
        },
        select: {
            id: true,
            staffProfile: {
                select: {
                    employeeCode: true,
                },
            },
        },
    });
    if (!user) {
        notice = "settings-user-not-found";
    }
    else {
        const employeeCode = employeeCodeInput || user.staffProfile?.employeeCode || defaultEmployeeCode(user.id);
        const storedAvatar = isUploadedPatientFile(avatarFile)
            ? await storeStaffProfileUpload({
                file: avatarFile,
                organizationId: session.organizationId,
                userId: user.id,
            })
            : null;
        const profileData = {
            clinicId: clinicId || null,
            employeeCode,
            title,
            department,
            contractType,
            baseSalary: baseSalary || null,
            hireDate: hireDate || null,
            dateOfBirth: dateOfBirth || null,
            gender,
            ...(storedAvatar
                ? {
                    avatarFileName: storedAvatar.fileName,
                    avatarMimeType: storedAvatar.mimeType,
                    avatarSizeBytes: storedAvatar.sizeBytes,
                    avatarStorageProvider: storedAvatar.storageProvider,
                    avatarStorageKey: storedAvatar.storageKey,
                    avatarThumbnailMimeType: storedAvatar.thumbnail?.mimeType ?? null,
                    avatarThumbnailStorageKey: storedAvatar.thumbnail?.storageKey ?? null,
                }
                : {}),
        };
        await prisma.$transaction([
            prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    fullName,
                    phone,
                },
            }),
            prisma.staffProfile.upsert({
                where: {
                    userId: user.id,
                },
                create: {
                    organizationId: session.organizationId,
                    userId: user.id,
                    ...profileData,
                },
                update: profileData,
            }),
            prisma.auditLog.create({
                data: {
                    organizationId: session.organizationId,
                    actorId: databaseActorId(session.userId),
                    action: "staff.profile_updated",
                    entityType: "User",
                    entityId: user.id,
                    metadata: {
                        employeeCode,
                        avatarUploaded: Boolean(storedAvatar),
                    } as Prisma.InputJsonValue,
                },
            }),
        ]);
    }
    return { notice };
}
