const target = process.env.READINESS_URL || "http://127.0.0.1:3000/api/readiness";

try {
  const response = await fetch(target, { cache: "no-store" });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body || body.status === "fail") {
    console.error(`${target} -> HTTP ${response.status}: ${JSON.stringify(body)}`);
    process.exitCode = 1;
  } else {
    console.log(`${target} -> ${JSON.stringify(body)}`);
  }
} catch (error) {
  console.error(`${target} -> ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
