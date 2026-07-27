import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.SECURITY_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const managerEmail =
  process.env.SECURITY_SMOKE_MANAGER_EMAIL ?? "manager@nhavista.vn";
const managerPassword =
  process.env.SECURITY_SMOKE_MANAGER_PASSWORD ?? "CodexSmoke2026!";
const ownerEmail =
  process.env.SECURITY_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run security regression smoke against production.");
  }

  const cookie = await login(managerEmail, managerPassword);
  const settingsHtml = await fetchText("/settings", cookie);
  const owner = await prisma.user.findUniqueOrThrow({
    where: {
      email: ownerEmail,
    },
    select: {
      id: true,
      organizationId: true,
      active: true,
      role: true,
      clinics: {
        take: 1,
        select: {
          clinicId: true,
        },
      },
      roleAssignments: {
        where: {
          active: true,
        },
        select: {
          role: true,
        },
      },
    },
  });

  const forms = Array.from(settingsHtml.matchAll(/<form[\s\S]*?<\/form>/g)).map(
    (match) => match[0],
  );
  const toggleAction = actionForOwnerForm(forms, owner.id, {
    include: ["active"],
  });
  const roleAction = actionForOwnerForm(forms, owner.id, {
    include: ["assignmentRole", "assignmentClinicId"],
  });
  const setupAction = actionForOwnerForm(forms, owner.id, {
    exclude: ["active", "assignmentRole", "fullName"],
  });
  const tokenCountBefore = await prisma.passwordResetToken.count({
    where: {
      userId: owner.id,
    },
  });

  const [toggleResponse, roleResponse, setupResponse] = await Promise.all([
    postAction(cookie, toggleAction, {
      userId: owner.id,
      active: "false",
    }),
    postAction(cookie, roleAction, {
      userId: owner.id,
      assignmentRole: ["FRONT_DESK"],
      assignmentClinicId: "",
    }),
    postAction(cookie, setupAction, {
      userId: owner.id,
    }),
  ]);
  const ownerAfter = await prisma.user.findUniqueOrThrow({
    where: {
      id: owner.id,
    },
    select: {
      active: true,
      role: true,
      roleAssignments: {
        where: {
          active: true,
        },
        select: {
          role: true,
        },
      },
    },
  });
  const tokenCountAfter = await prisma.passwordResetToken.count({
    where: {
      userId: owner.id,
    },
  });

  assertDenied(toggleResponse, "owner status change");
  assertDenied(roleResponse, "owner role change");
  assertDenied(setupResponse, "owner password setup");

  if (
    !ownerAfter.active ||
    ownerAfter.role !== "OWNER" ||
    !ownerAfter.roleAssignments.some((assignment) => assignment.role === "OWNER") ||
    tokenCountAfter !== tokenCountBefore
  ) {
    throw new Error("A clinic manager changed owner credentials or authorization.");
  }

  const marker = `credential-leak-${Date.now()}`;
  const notification = await prisma.notification.create({
    data: {
      organizationId: owner.organizationId,
      clinicId: owner.clinics[0]?.clinicId ?? null,
      userId: owner.id,
      channel: "EMAIL",
      status: "FAILED",
      templateKey: "PASSWORD_RESET",
      recipient: ownerEmail,
      subject: "Credential regression",
      body: `https://example.test/reset-password?token=${marker}`,
    },
  });

  try {
    const dashboardHtml = await fetchText("/dashboard", cookie);

    if (dashboardHtml.includes(marker)) {
      throw new Error("A credential notification leaked into another user's inbox.");
    }
  } finally {
    await prisma.notification.delete({
      where: {
        id: notification.id,
      },
    });
  }

  await assertPasswordResetSingleUse(owner);
  console.log("ok security regression smoke");
}

async function assertPasswordResetSingleUse(owner) {
  const original = await prisma.user.findUniqueOrThrow({
    where: {
      id: owner.id,
    },
    select: {
      mustChangePassword: true,
      passwordChangedAt: true,
      passwordHash: true,
    },
  });
  const token = randomBytes(32).toString("base64url");
  const resetToken = await prisma.passwordResetToken.create({
    data: {
      organizationId: owner.organizationId,
      userId: owner.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      purpose: "QA_CONCURRENT_RESET",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  try {
    const html = await fetchText(`/reset-password?token=${encodeURIComponent(token)}`, "");
    const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

    if (!action) {
      throw new Error("Could not find reset password action.");
    }

    const fields = {
      token,
      password: "ConcurrentReset2026!",
      confirmPassword: "ConcurrentReset2026!",
    };
    const responses = await Promise.all([
      postAction("", action, fields, `/reset-password?token=${encodeURIComponent(token)}`),
      postAction("", action, fields, `/reset-password?token=${encodeURIComponent(token)}`),
    ]);
    const locations = responses.map((response) => response.headers.get("location") ?? "");
    const successCount = locations.filter((location) => location === "/login?reset=success").length;
    const expiredCount = locations.filter((location) => location.includes("error=expired")).length;

    if (successCount !== 1 || expiredCount !== 1) {
      throw new Error(
        `Password reset token was not single-use (redirects: ${locations.join(", ")}).`,
      );
    }
  } finally {
    await prisma.user.update({
      where: {
        id: owner.id,
      },
      data: original,
    });
    await prisma.passwordResetToken.deleteMany({
      where: {
        id: resetToken.id,
      },
    });
  }

  console.log("ok atomic password reset token claim");
}

function actionForOwnerForm(forms, ownerId, options) {
  const form = forms.find((candidate) => {
    const names = Array.from(candidate.matchAll(/name="([^"]+)"/g)).map(
      (match) => match[1],
    );

    return (
      candidate.includes(`value="${ownerId}"`) &&
      names.includes("userId") &&
      (options.include ?? []).every((name) => names.includes(name)) &&
      (options.exclude ?? []).every((name) => !names.includes(name))
    );
  });
  const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error("Could not find the expected staff management action.");
  }

  return action;
}

async function login(email, password) {
  const html = await fetchText("/login", "");
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error("Could not find the login action.");
  }

  const response = await postAction("", action, { email, password }, "/login");
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

  if (!cookie) {
    throw new Error("Security smoke manager login did not return a session.");
  }

  return cookie;
}

async function postAction(cookie, action, fields, path = "/settings") {
  const form = new FormData();
  form.set(action, "");

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      value.forEach((item) => form.append(key, item));
    } else {
      form.set(key, value);
    }
  }

  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: form,
    headers: {
      cookie,
      origin: baseUrl,
    },
    redirect: "manual",
  });
}

async function fetchText(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie,
      origin: baseUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }

  return response.text();
}

function assertDenied(response, label) {
  if (
    response.status !== 303 ||
    response.headers.get("location") !== "/settings?notice=settings-denied"
  ) {
    throw new Error(`${label} was not denied by the server action.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
