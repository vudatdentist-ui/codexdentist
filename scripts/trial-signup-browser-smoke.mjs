import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const base = new URL(process.env.TRIAL_QA_BASE_URL ?? "http://127.0.0.1:3000");

if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Trial signup smoke must target a disposable loopback server.");
}

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
const page = await context.newPage();
const token = randomUUID().slice(0, 8);
const email = `trial-smoke-${token}@example.test`;
const password = "TrialSmokePassword!2026";
const startedAt = Date.now();

try {
  const response = await page.goto(new URL("/signup", base).href, {
    waitUntil: "networkidle",
  });
  assert.equal(response?.status(), 200);
  await page.getByRole("heading", { name: "Tạo tài khoản phòng khám" }).waitFor();

  await page.getByLabel("Tên phòng khám").fill(`Nha khoa Trial ${token}`);
  await page.getByLabel("Tỉnh / thành phố").fill("Hà Nội");
  await page.getByLabel("Họ tên của bạn").fill("Nguyễn Trial Smoke");
  await page.getByLabel("Email đăng nhập").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Nhập lại mật khẩu").fill(password);

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 }),
    page.getByRole("button", { name: "Tạo tài khoản dùng thử" }).click(),
  ]);
  await page.getByLabel("Trạng thái dùng thử").getByText(/Còn 30 ngày/).waitFor();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      organization: {
        select: {
          id: true,
          isDemo: true,
          slug: true,
          trialEndsAt: true,
        },
      },
    },
  });

  assert.ok(user, "Trial owner should be persisted.");
  assert.equal(user.organization.isDemo, false, "Trial must not use demo cleanup semantics.");
  assert.ok(user.organization.slug, "Trial workspace needs a tenant slug.");
  assert.ok(user.organization.trialEndsAt, "Trial expiration must be persisted.");

  const durationMs = user.organization.trialEndsAt.getTime() - startedAt;
  const dayMs = 24 * 60 * 60 * 1000;
  assert.ok(
    durationMs >= 29.9 * dayMs && durationMs <= 30.1 * dayMs,
    `Expected a 30-day trial, received ${durationMs / dayMs} days.`,
  );

  await prisma.organization.update({
    where: { id: user.organization.id },
    data: { trialEndsAt: new Date(Date.now() - 60_000) },
  });
  await prisma.session.deleteMany({
    where: { userId: user.id },
  });
  await context.clearCookies();

  await page.goto(new URL("/login", base).href, { waitUntil: "networkidle" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu").fill(password);

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("error") === "trial-expired"),
    page.getByRole("button", { name: "Đăng nhập" }).click(),
  ]);

  await page.getByText("Thời gian dùng thử 30 ngày đã kết thúc.").waitFor();
  console.log("Trial signup browser smoke passed.");
} finally {
  await context.close();
  await browser.close();
  await prisma.$disconnect();
}
