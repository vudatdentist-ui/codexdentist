import { NextResponse } from "next/server";
import { DomainRuleError } from "@/domains/errors";
import { applicationErrorCode } from "@/lib/application/errors";

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function apiError(code: string, status: number) {
  return noStoreJson({ error: code }, { status });
}

export function commandErrorCode(cause: unknown, fallback: string) {
  if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") return "operation-unique-conflict";
  return cause instanceof DomainRuleError ? cause.code : applicationErrorCode(cause, fallback);
}
