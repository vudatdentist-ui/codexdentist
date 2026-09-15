import assert from "node:assert/strict";
import { appointmentHref, appointmentStatus, flowCounts, scopedTasks, sortTasks, taskAction } from "../src/workspaces/today/model.ts";

// Test the regressions that matter at the operations desk, independent of a DB.
const appointment = (id, status) => ({ id, clinicId: "a", time: "09:00", patientName: "Test patient", providerName: "Test provider", clinicName: "Test clinic", procedure: "Exam", status });
const appointments = Array.from({ length: 24 }, (_, index) => appointment(String(index), index < 17 ? "ARRIVED" : "In chair"));
assert.deepEqual(flowCounts(appointments), { REQUESTED: 0, CONFIRMED: 0, ARRIVED: 17, IN_CHAIR: 7, COMPLETED: 0 });
assert.equal(appointmentStatus("No-show"), "NO_SHOW");
assert.equal(flowCounts([appointment("cancel", "CANCELLED")]).CONFIRMED, 0);
assert.equal(flowCounts([]).ARRIVED, 0);

const task = (id, extras = {}) => ({ id, sourceId: id, kind: "notification", priority: "medium", title: "Test task", detail: "", href: "/patients", dueAt: null, patientName: null, clinicName: "Same clinic name", clinicId: "a", status: "OPEN", assignedToName: null, actionable: true, ...extras });
assert.equal(taskAction(task("notification-1")), "open", "A notification link must never complete a WorkItem");
assert.equal(taskAction(task("notification-1", { status: "FAILED" })), "retry");
assert.equal(taskAction(task("work-1")), "complete");
assert.equal(taskAction(task("work-1", { sourceId: null })), "open");
assert.equal(taskAction(task("work-1", { actionable: false })), "open");
assert.equal(taskAction(task("crm-1", { kind: "crm" })), "open");

const crossClinic = [task("a"), task("b", { clinicId: "b" }), task("global", { clinicId: null }), task("unknown", { clinicId: undefined })];
assert.deepEqual(scopedTasks(crossClinic, new Set(["a"]), true).map((item) => item.id), ["a", "global"], "Scope must use IDs, even when clinic names are identical");
assert.deepEqual(scopedTasks(crossClinic, new Set(["a", "b"]), false).map((item) => item.id), ["a", "b", "global", "unknown"]);

const unsorted = [task("later", { dueAtIso: "2026-09-20T00:00:00Z" }), task("urgent", { priority: "high" }), task("early", { dueAtIso: "2026-09-15T00:00:00Z" }), task("invalid", { dueAtIso: "invalid" })];
assert.deepEqual(sortTasks(unsorted).map((item) => item.id), ["urgent", "early", "later", "invalid"]);
assert.equal(unsorted[0].id, "later", "Sorting must not mutate shared query data");
const href = appointmentHref({ ...appointment("x", "ARRIVED"), patientId: "p&clinicId=other" });
assert.equal(new URL(href, "http://example.test").searchParams.get("patientId"), "p&clinicId=other");
assert.equal(new URL(href, "http://example.test").searchParams.has("clinicId"), false);
assert.equal(appointmentHref(appointment("x", "ARRIVED")), "/schedule");
console.log("ok today workspace: complete counts, clinic scope, action dispatch, priority ordering, patient links");
