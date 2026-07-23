const targets = [
  process.env.AGENT_HEALTH_URL || "http://127.0.0.1:3000/api/health",
];

let failed = false;

for (const target of targets) {
  try {
    const response = await fetch(target, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      failed = true;
      console.error(`${target} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
      continue;
    }
    console.log(`${target} -> ${text}`);
  } catch (error) {
    failed = true;
    console.error(`${target} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  process.exitCode = 1;
}

