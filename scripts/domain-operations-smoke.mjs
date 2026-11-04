import { assertLabTransition } from "../src/domains/operations/lab.ts";
import { assertSterilizationTransition } from "../src/domains/operations/sterilization.ts";

assertPass(() => assertLabTransition("DRAFT", "SENT"), "Lab allows DRAFT to SENT");
assertReject(
  () => assertLabTransition("DELIVERED", "SENT"),
  "lab-status-transition-invalid",
  "Lab rejects transitions from DELIVERED",
);
assertPass(() => assertSterilizationTransition("RUNNING", "FAILED"), "Sterilization allows RUNNING to FAILED");
assertReject(
  () => assertSterilizationTransition("RELEASED", "RUNNING"),
  "sterilization-status-transition-invalid",
  "Sterilization rejects transitions from RELEASED",
);
console.log("ok domain operations smoke");

function assertPass(action, label) {
  action();
  console.log(`ok ${label}`);
}

function assertReject(action, expectedCode, label) {
  try {
    action();
  } catch (error) {
    if (error?.code === expectedCode) {
      console.log(`ok ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Domain operations smoke failed: ${label}`);
}
