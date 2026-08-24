import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const patientWorkspaceRoot = "src/workspaces/patients";
const files = [];
walk(patientWorkspaceRoot);

const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (text.includes("@/modules/journey/PatientJourneyPanel") || text.includes("PatientJourneyPanel")) {
    findings.push(`${file}: Patient 360 must not depend on legacy PatientJourneyPanel`);
  }
  if (/from\s+["']@\/app\//.test(text) || /from\s+["']\.\.\/\.\.\/app\//.test(text)) {
    findings.push(`${file}: Patient 360 workspace must not import app-route actions`);
  }
}

const legacyPatientManagement = readFileSync("src/app/(app)/patient-management/page.tsx", "utf8");
if (legacyPatientManagement.includes("AppViewPage") || legacyPatientManagement.includes("DentalSuite")) {
  findings.push("/patient-management still delegates to AppViewPage/DentalSuite");
}

const odontogramEditor = readFileSync("src/components/PatientOdontogramEditor.tsx", "utf8");
if (odontogramEditor.includes("@/app/(app)/journey/odontogram-actions")) {
  findings.push("PatientOdontogramEditor still depends on Journey route actions instead of Patient 360 feature actions");
}
if (!odontogramEditor.includes("@/features/patient-360/server/odontogram-actions")) {
  findings.push("PatientOdontogramEditor is not bound to the Patient 360 odontogram feature boundary");
}

const requiredFeatureActions = [
  "src/features/patient-360/server/patient-actions.ts",
  "src/features/patient-360/server/clinical-actions.ts",
  "src/features/patient-360/server/journey-actions.ts",
  "src/features/patient-360/server/odontogram-actions.ts",
  "src/features/patient-360/server/patient-file-actions.ts",
];
for (const file of requiredFeatureActions) {
  try {
    readFileSync(file, "utf8");
  } catch {
    findings.push(`${file}: required Patient 360 feature action module is missing`);
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("patient-360-architecture-audit: ok");
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      files.push(path);
    }
  }
}
