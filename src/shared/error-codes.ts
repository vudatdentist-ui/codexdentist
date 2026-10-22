export function safeErrorCode(error: unknown, fallback: string) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return /^[a-z0-9_.:-]{1,120}$/i.test(candidate) ? candidate : fallback;
}
