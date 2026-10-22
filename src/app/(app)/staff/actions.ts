"use server";
import { optionalPositiveInteger, optionalPercentageInput } from "@/lib/application/staff/support";
import { ApplicationCommandError } from "@/lib/application/errors";
import { positiveInteger, percentageInput, parseOverridesJson, } from "@/lib/application/staff/support";
import { createPayrollRunFromAccrualsCommand } from "@/lib/application/staff/create-payroll-run-from-accruals-command";
import { updatePayrollPolicyCommand } from "@/lib/application/staff/update-payroll-policy-command";
import { importPayrollPoliciesCommand } from "@/lib/application/staff/import-payroll-policies-command";
import { createStaffShiftCommand } from "@/lib/application/staff/create-staff-shift-command";
import { clockInStaffCommand } from "@/lib/application/staff/clock-in-staff-command";
import { clockOutStaffCommand } from "@/lib/application/staff/clock-out-staff-command";
import { createLeaveRequestCommand } from "@/lib/application/staff/create-leave-request-command";
import { updateLeaveRequestStatusCommand } from "@/lib/application/staff/update-leave-request-status-command";
import { adjustAttendanceLogCommand } from "@/lib/application/staff/adjust-attendance-log-command";
import { approvePayrollRunCommand } from "@/lib/application/staff/approve-payroll-run-command";
import { markPayrollRunPaidCommand } from "@/lib/application/staff/mark-payroll-run-paid-command";
import { voidPayrollRunCommand } from "@/lib/application/staff/void-payroll-run-command";
import { reportApplicationError } from "@/lib/error-reporting";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { parseDateInVietnam, parseEndOfDateInVietnam, parseMoney, requiredString, } from "@/lib/form-validation";
export async function createPayrollRunFromAccrualsAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const periodStart = parseDateInVietnam(formData.get("periodStart"));
    const periodEnd = parseEndOfDateInVietnam(formData.get("periodEnd"), () => new Date());
    const clinicId = requiredString(formData.get("clinicId"));
    const includeBaseSalary = formData.get("includeBaseSalary") === "on";
    const submittedStandardWorkdays = optionalPositiveInteger(formData.get("standardWorkdays"));
    const submittedTaxPercent = optionalPercentageInput(formData.get("taxPercent"));
    const submittedInsurancePercent = optionalPercentageInput(formData.get("insurancePercent"));
    const submittedOtherDeductionAmount = parseMoney(formData.get("otherDeductionAmount"));
    try {
        await createPayrollRunFromAccrualsCommand({ session, submittedStandardWorkdays, submittedTaxPercent, submittedInsurancePercent, submittedOtherDeductionAmount, periodStart, periodEnd, includeBaseSalary, clinicId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-created");
}
export async function updatePayrollPolicyAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const clinicIdInput = requiredString(formData.get("clinicId"));
    const includeBaseSalary = formData.get("includeBaseSalary") === "on";
    const standardWorkdays = positiveInteger(formData.get("standardWorkdays"), 26);
    const taxPercent = percentageInput(formData.get("taxPercent"));
    const insurancePercent = percentageInput(formData.get("insurancePercent"));
    const otherDeductionAmount = Math.max(Number(parseMoney(formData.get("otherDeductionAmount")) ?? 0), 0);
    const roleOverrides = parseOverridesJson(formData.get("roleOverridesJson"));
    const staffOverrides = parseOverridesJson(formData.get("staffOverridesJson"));
    try {
        await updatePayrollPolicyCommand({ session, roleOverrides, staffOverrides, includeBaseSalary, standardWorkdays, taxPercent, insurancePercent, otherDeductionAmount, clinicIdInput });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-policy-saved");
}
export async function importPayrollPoliciesAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const csvText = requiredString(formData.get("csvText"));
    try {
        await importPayrollPoliciesCommand({ csvText, session });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-payroll-policy-import-failed");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-policy-imported");
}
export async function createStaffShiftAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const staffProfileId = requiredString(formData.get("staffProfileId"));
    const clinicId = requiredString(formData.get("clinicId"));
    const date = requiredString(formData.get("date"));
    const startTime = requiredString(formData.get("startTime"));
    const endTime = requiredString(formData.get("endTime"));
    const roleOnShiftInput = requiredString(formData.get("roleOnShift"));
    const notesInput = requiredString(formData.get("notes"));
    try {
        await createStaffShiftCommand({ session, staffProfileId, roleOnShiftInput, notesInput, clinicId, date, startTime, endTime });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-shift-created");
}
export async function clockInStaffAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const staffProfileId = requiredString(formData.get("staffProfileId"));
    const clinicId = requiredString(formData.get("clinicId"));
    const noteInput = requiredString(formData.get("note"));
    try {
        await clockInStaffCommand({ session, staffProfileId, noteInput, clinicId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-clocked-in");
}
export async function clockOutStaffAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const attendanceLogId = requiredString(formData.get("attendanceLogId"));
    const outStatusInput = requiredString(formData.get("outStatus"));
    try {
        await clockOutStaffCommand({ attendanceLogId, session, outStatusInput });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-clocked-out");
}
export async function createLeaveRequestAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const staffProfileId = requiredString(formData.get("staffProfileId"));
    const startsAt = parseDateInVietnam(formData.get("startsAt"));
    const endsAt = parseEndOfDateInVietnam(formData.get("endsAt"), () => new Date());
    const leaveTypeInput = requiredString(formData.get("leaveType"));
    const hoursInput = parseMoney(formData.get("hours"));
    const reasonInput = requiredString(formData.get("reason"));
    try {
        await createLeaveRequestCommand({ session, staffProfileId, startsAt, leaveTypeInput, hoursInput, reasonInput, endsAt });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-leave-created");
}
export async function updateLeaveRequestStatusAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const leaveRequestId = requiredString(formData.get("leaveRequestId"));
    const status = requiredString(formData.get("status"));
    const nextStatus = status as "APPROVED" | "REJECTED";
    const decisionNoteInput = requiredString(formData.get("decisionNote"));
    try {
        await updateLeaveRequestStatusCommand({ leaveRequestId, session, decisionNoteInput, status });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect(`/staff?notice=${nextStatus === "APPROVED" ? "staff-leave-approved" : "staff-leave-rejected"}`);
}
export async function adjustAttendanceLogAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const attendanceLogId = requiredString(formData.get("attendanceLogId"));
    const clockInDate = requiredString(formData.get("clockInDate"));
    const clockInTime = requiredString(formData.get("clockInTime"));
    const clockOutDate = requiredString(formData.get("clockOutDate"));
    const clockOutTime = requiredString(formData.get("clockOutTime"));
    const outStatusInput = requiredString(formData.get("outStatus"));
    const noteInput = requiredString(formData.get("note"));
    try {
        await adjustAttendanceLogCommand({ attendanceLogId, session, outStatusInput, noteInput, clockInDate, clockInTime, clockOutDate, clockOutTime });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-attendance-adjusted");
}
export async function approvePayrollRunAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const payrollRunId = requiredString(formData.get("payrollRunId"));
    try {
        await approvePayrollRunCommand({ session, payrollRunId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-approved");
}
export async function markPayrollRunPaidAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const payrollRunId = requiredString(formData.get("payrollRunId"));
    try {
        await markPayrollRunPaidCommand({ session, payrollRunId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-paid");
}
export async function voidPayrollRunAction(formData: FormData) {
    const session = await requireViewSession("staff");
    const payrollRunId = requiredString(formData.get("payrollRunId"));
    try {
        await voidPayrollRunCommand({ session, payrollRunId });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/staff?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/staff/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/staff?notice=staff-database");
    }
    revalidatePath("/staff");
    redirect("/staff?notice=staff-payroll-voided");
}
function isNextRedirect(error: unknown) {
    return (typeof error === "object" &&
        error !== null &&
        "digest" in error &&
        String((error as {
            digest?: unknown;
        }).digest).startsWith("NEXT_REDIRECT"));
}
