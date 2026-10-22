"use server";
import { optionalString, optionalDate, optionalDecimal, deliverSetupNotification } from "@/lib/application/settings/support";
import { ApplicationCommandError } from "@/lib/application/errors";
import { PasswordSetupArtifacts, isStaffProfileRole } from "@/lib/application/settings/support";
import { createOrganizationCommand } from "@/lib/application/settings/create-organization-command";
import { createStaffCommand } from "@/lib/application/settings/create-staff-command";
import { createStaffPasswordSetupLinkCommand } from "@/lib/application/settings/create-staff-password-setup-link-command";
import { createClinicCommand } from "@/lib/application/settings/create-clinic-command";
import { updateClinicCommand } from "@/lib/application/settings/update-clinic-command";
import { createChairCommand } from "@/lib/application/settings/create-chair-command";
import { updateChairCommand } from "@/lib/application/settings/update-chair-command";
import { toggleChairStatusCommand } from "@/lib/application/settings/toggle-chair-status-command";
import { createChainCommand } from "@/lib/application/settings/create-chain-command";
import { updateChainCommand } from "@/lib/application/settings/update-chain-command";
import { toggleChainStatusCommand } from "@/lib/application/settings/toggle-chain-status-command";
import { toggleClinicStatusCommand } from "@/lib/application/settings/toggle-clinic-status-command";
import { updateStaffRoleCommand } from "@/lib/application/settings/update-staff-role-command";
import { updateStaffProfileCommand } from "@/lib/application/settings/update-staff-profile-command";
import { createSourceCommissionPolicyCommand } from "@/lib/application/settings/create-source-commission-policy-command";
import { toggleSourceCommissionPolicyCommand } from "@/lib/application/settings/toggle-source-commission-policy-command";
import { generateSourceCommissionAccrualsCommand } from "@/lib/application/settings/generate-source-commission-accruals-command";
import { updateSourceCommissionAccrualStatusCommand } from "@/lib/application/settings/update-source-commission-accrual-status-command";
import { sendNotificationTestCommand } from "@/lib/application/settings/send-notification-test-command";
import { toggleStaffStatusCommand } from "@/lib/application/settings/toggle-staff-status-command";
import { reportApplicationError } from "@/lib/error-reporting";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { requiredString } from "@/lib/form-validation";
import { normalizeTenantSlug, tenantDomainForSlug, } from "@/lib/tenant";
export async function createOrganizationAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const name = requiredString(formData.get("name"));
    const slug = normalizeTenantSlug(requiredString(formData.get("slug")));
    const ownerFullName = requiredString(formData.get("ownerFullName"));
    const ownerEmail = requiredString(formData.get("ownerEmail")).toLowerCase();
    const domain = tenantDomainForSlug(slug);
    let result: {
        organization: {
            id: string;
            name: string;
            slug: string | null;
            primaryDomain: string | null;
        };
        owner: {
            id: string;
            email: string;
            fullName: string;
        };
        setup: PasswordSetupArtifacts;
    } | null = null;
    try {
        ({ result } = await createOrganizationCommand({ ownerEmail, name, ownerFullName, session, slug }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error))
            throw error;
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-organization-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    if (!result) {
        redirect("/settings?notice=settings-database");
    }
    await deliverSetupNotification(result.setup);
    revalidatePath("/settings");
    redirect("/settings?notice=settings-organization-created&domain=" +
        encodeURIComponent(domain));
}
export async function createStaffAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const fullName = requiredString(formData.get("fullName"));
    const email = requiredString(formData.get("email")).toLowerCase();
    const title = optionalString(formData.get("title"));
    const clinicId = requiredString(formData.get("clinicId"));
    const createAssignmentRoles = Array.from(new Set(formData
        .getAll("assignmentRole")
        .map((value) => requiredString(value))
        .filter(isStaffProfileRole)));
    let result: {
        userId: string;
        setup: PasswordSetupArtifacts;
    } | null = null;
    try {
        ({ result } = await createStaffCommand({ createAssignmentRoles, clinicId, title, session, email, fullName }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error))
            throw error;
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-email-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    if (!result) {
        redirect("/settings?notice=settings-database");
    }
    await deliverSetupNotification(result.setup);
    revalidatePath("/settings");
    redirect("/settings?notice=settings-staff-created&setupEmail=" +
        encodeURIComponent(email));
}
export async function createStaffPasswordSetupLinkAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const userId = requiredString(formData.get("userId"));
    let setup: PasswordSetupArtifacts | null = null;
    let setupEmail = "";
    try {
        ({ setup, setupEmail } = await createStaffPasswordSetupLinkCommand({ session, userId }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error))
            throw error;
        redirect("/settings?notice=settings-database");
    }
    if (!setup) {
        redirect("/settings?notice=settings-database");
    }
    await deliverSetupNotification(setup);
    revalidatePath("/settings");
    redirect("/settings?notice=settings-password-link-created&setupEmail=" +
        encodeURIComponent(setupEmail));
}
export async function createClinicAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const name = requiredString(formData.get("name"));
    const organizationIdInput = optionalString(formData.get("organizationId"));
    const city = requiredString(formData.get("city"));
    const address = requiredString(formData.get("address"));
    const phone = requiredString(formData.get("phone"));
    try {
        await createClinicCommand({ session, organizationIdInput, phone, name, city, address });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-clinic-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-clinic-created");
}
export async function updateClinicAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const clinicId = requiredString(formData.get("clinicId"));
    const name = requiredString(formData.get("name"));
    const city = requiredString(formData.get("city"));
    const address = requiredString(formData.get("address"));
    const phone = requiredString(formData.get("phone"));
    try {
        await updateClinicCommand({ clinicId, phone, session, name, city, address });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-clinic-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-clinic-updated");
}
export async function createChairAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const clinicId = requiredString(formData.get("clinicId"));
    const name = requiredString(formData.get("name"));
    const specialty = optionalString(formData.get("specialty"));
    try {
        await createChairCommand({ session, clinicId, name, specialty });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-chair-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/schedule");
    redirect("/settings?notice=settings-chair-created");
}
export async function updateChairAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const chairId = requiredString(formData.get("chairId"));
    const clinicId = requiredString(formData.get("clinicId"));
    const name = requiredString(formData.get("name"));
    const specialty = optionalString(formData.get("specialty"));
    try {
        await updateChairCommand({ chairId, session, name, specialty, clinicId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-chair-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/schedule");
    redirect("/settings?notice=settings-chair-updated");
}
export async function toggleChairStatusAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const chairId = requiredString(formData.get("chairId"));
    const clinicId = requiredString(formData.get("clinicId"));
    const active = requiredString(formData.get("active")) === "true";
    try {
        await toggleChairStatusCommand({ chairId, active, session, clinicId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/schedule");
    redirect(active ? "/settings?notice=settings-chair-activated" : "/settings?notice=settings-chair-deactivated");
}
export async function createChainAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const name = requiredString(formData.get("name"));
    const legalName = optionalString(formData.get("legalName"));
    const brandName = optionalString(formData.get("brandName"));
    const taxCode = optionalString(formData.get("taxCode"));
    const phone = optionalString(formData.get("phone"));
    const email = optionalString(formData.get("email"));
    const website = optionalString(formData.get("website"));
    const specialty = optionalString(formData.get("specialty")) ?? "DENTAL";
    const ownerMode = optionalString(formData.get("ownerMode")) ?? "none";
    const ownerUserId = optionalString(formData.get("ownerUserId"));
    const ownerFullName = optionalString(formData.get("ownerFullName"));
    const ownerEmail = optionalString(formData.get("ownerEmail"))?.toLowerCase() ?? null;
    let setup: PasswordSetupArtifacts | null = null;
    try {
        ({ setup } = await createChainCommand({ ownerMode, ownerFullName, ownerEmail, session, name, legalName, brandName, taxCode, phone, email, website, specialty, ownerUserId }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error))
            throw error;
        if (isUniqueConstraintError(error)) {
            redirect(ownerMode === "new"
                ? "/settings?notice=settings-email-exists"
                : "/settings?notice=settings-chain-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    if (setup) {
        await deliverSetupNotification(setup);
    }
    revalidatePath("/settings");
    redirect(ownerMode === "new" && ownerEmail
        ? "/settings?notice=settings-chain-created&setupEmail=" +
            encodeURIComponent(ownerEmail)
        : "/settings?notice=settings-chain-created");
}
export async function updateChainAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const chainId = requiredString(formData.get("chainId"));
    const name = requiredString(formData.get("name"));
    const legalName = optionalString(formData.get("legalName"));
    const brandName = optionalString(formData.get("brandName"));
    const taxCode = optionalString(formData.get("taxCode"));
    const phone = optionalString(formData.get("phone"));
    const email = optionalString(formData.get("email"));
    const website = optionalString(formData.get("website"));
    const specialty = optionalString(formData.get("specialty")) ?? "DENTAL";
    const ownerIdInput = optionalString(formData.get("ownerId"));
    try {
        await updateChainCommand({ ownerIdInput, session, chainId, name, legalName, brandName, taxCode, phone, email, website, specialty });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        if (isUniqueConstraintError(error)) {
            redirect("/settings?notice=settings-chain-exists");
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-chain-updated");
}
export async function toggleChainStatusAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const chainId = requiredString(formData.get("chainId"));
    const active = requiredString(formData.get("active")) === "true";
    try {
        await toggleChainStatusCommand({ chainId, session, active });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    redirect(active ? "/settings?notice=settings-chain-activated" : "/settings?notice=settings-chain-deactivated");
}
export async function toggleClinicStatusAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const clinicId = requiredString(formData.get("clinicId"));
    const active = requiredString(formData.get("active")) === "true";
    try {
        await toggleClinicStatusCommand({ clinicId, session, active });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    redirect(active ? "/settings?notice=settings-clinic-activated" : "/settings?notice=settings-clinic-deactivated");
}
export async function updateStaffRoleAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const userId = requiredString(formData.get("userId"));
    const assignmentClinicId = optionalString(formData.get("assignmentClinicId"));
    const assignmentRoles = Array.from(new Set(formData
        .getAll("assignmentRole")
        .map((value) => requiredString(value))
        .filter(isStaffProfileRole)));
    let notice: string | null = null;
    try {
        ({ notice } = await updateStaffRoleCommand({ session, userId, assignmentRoles, assignmentClinicId }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        notice = "settings-database";
    }
    if (notice) {
        redirect(`/settings?notice=${notice}`);
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-role-updated");
}
export async function updateStaffProfileAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const userId = requiredString(formData.get("userId"));
    const fullName = requiredString(formData.get("fullName"));
    const phone = optionalString(formData.get("phone"));
    const employeeCodeInput = optionalString(formData.get("employeeCode"));
    const title = optionalString(formData.get("title"));
    const department = optionalString(formData.get("department"));
    const contractType = optionalString(formData.get("contractType")) ?? "FULL_TIME";
    const clinicId = optionalString(formData.get("clinicId"));
    const hireDate = optionalDate(formData.get("hireDate"));
    const dateOfBirth = optionalDate(formData.get("dateOfBirth"));
    const gender = optionalString(formData.get("gender"));
    const baseSalary = optionalDecimal(formData.get("baseSalary"));
    const avatarFile = formData.get("avatar");
    let notice: string | null = null;
    try {
        ({ notice } = await updateStaffProfileCommand({ userId, session, employeeCodeInput, avatarFile, clinicId, baseSalary, hireDate, dateOfBirth, title, department, contractType, gender, fullName, phone }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isUniqueConstraintError(error)) {
            notice = "settings-profile-code-exists";
        }
        else {
            notice = "settings-database";
        }
    }
    if (notice) {
        redirect(`/settings?notice=${notice}`);
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-profile-updated");
}
export async function createSourceCommissionPolicyAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const source = requiredString(formData.get("source")).toUpperCase();
    const name = requiredString(formData.get("name"));
    const ownerLabel = optionalString(formData.get("ownerLabel"));
    const ratePercent = optionalDecimal(formData.get("ratePercent"));
    const fixedAmount = optionalDecimal(formData.get("fixedAmount")) ?? "0";
    const monthlyBudget = optionalDecimal(formData.get("monthlyBudget"));
    const notes = optionalString(formData.get("notes"));
    try {
        await createSourceCommissionPolicyCommand({ session, ratePercent, source, name, ownerLabel, fixedAmount, monthlyBudget, notes });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/reports");
    redirect("/settings?notice=settings-source-policy-saved");
}
export async function toggleSourceCommissionPolicyAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const policyId = requiredString(formData.get("policyId"));
    const active = requiredString(formData.get("active")) === "true";
    try {
        await toggleSourceCommissionPolicyCommand({ policyId, session, active });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/reports");
    redirect("/settings?notice=settings-source-policy-saved");
}
export async function generateSourceCommissionAccrualsAction() {
    const session = await requireViewSession("settings");
    try {
        await generateSourceCommissionAccrualsCommand({ session });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/reports");
    redirect("/settings?notice=settings-source-accruals-generated");
}
export async function updateSourceCommissionAccrualStatusAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const accrualId = requiredString(formData.get("accrualId"));
    const status = requiredString(formData.get("status"));
    try {
        await updateSourceCommissionAccrualStatusCommand({ accrualId, session, status });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/settings?notice=settings-database");
    }
    revalidatePath("/settings");
    revalidatePath("/reports");
    redirect("/settings?notice=settings-source-policy-saved");
}
export async function sendNotificationTestAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const channel = requiredString(formData.get("channel")).toUpperCase();
    const recipient = requiredString(formData.get("recipient"));
    const subject = requiredString(formData.get("subject")) || "Codexdentist notification test";
    const body = requiredString(formData.get("body")) ||
        "This is a safe delivery test from Codexdentist settings.";
    try {
        await sendNotificationTestCommand({ session, channel, recipient, subject, body });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/settings?notice=settings-notification-test-failed");
    }
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    redirect("/settings?notice=settings-notification-test-sent");
}
export async function toggleStaffStatusAction(formData: FormData) {
    const session = await requireViewSession("settings");
    const userId = requiredString(formData.get("userId"));
    const active = requiredString(formData.get("active")) === "true";
    let notice: string | null = null;
    try {
        ({ notice } = await toggleStaffStatusCommand({ session, userId, active }));
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/settings?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/settings/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        notice = "settings-database";
    }
    if (notice) {
        redirect(`/settings?notice=${notice}`);
    }
    revalidatePath("/settings");
    redirect("/settings?notice=settings-status-updated");
}
function isNextRedirect(error: unknown) {
    return (typeof error === "object" &&
        error !== null &&
        "digest" in error &&
        String((error as {
            digest?: unknown;
        }).digest).startsWith("NEXT_REDIRECT"));
}
function isUniqueConstraintError(error: unknown) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as {
            code?: unknown;
        }).code === "P2002");
}
