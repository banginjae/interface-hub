// Runs the MQTT Topic validator against drafts whose server verdict is pinned in
// internal/service/mqttschema_ux_test.go, so client and server rules stay aligned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "mqtt-validation");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "restValidation", "mqttModel", "mqttValidation"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (name) => import(new URL(`file:///${path.join(out, `${name}.mjs`).replace(/\\/g, "/")}`).href);
const spec = await load("specModel");
const mqtt = await load("mqttModel");
const check = await load("mqttValidation");

function base(topic = "devices/{deviceId}/status") {
  const draft = mqtt.blankMqtt();
  draft.topic = topic;
  draft.name = "장비 상태";
  draft.changeReason = "test";
  return draft;
}
function f(name, type = "string", example = "") {
  return Object.assign(spec.blankField(name), { type, example });
}

const cases = [
  ["valid: variable topic with string field", true, () => { const d = base(); d.payload.fields = [f("deviceId", "string", "dev-1")]; return d; }],
  ["valid: single-level wildcard", true, () => base("gateway/+/event")],
  ["valid: multi-level wildcard at end", true, () => base("devices/#")],
  ["valid: no payload fields", true, () => base()],
  ["valid: publishers and subscribers", true, () => { const d = base(); d.publishers = ["센서"]; d.subscribers = ["서버"]; return d; }],
  ["empty topic", false, () => base("")],
  ["empty level (double slash)", false, () => base("a//b")],
  ["leading slash", false, () => base("/a/b")],
  ["trailing slash", false, () => base("a/b/")],
  ["space in topic", false, () => base("a b/c")],
  ["hash not last", false, () => base("sport/#/late")],
  ["hash inside level", false, () => base("a/b#")],
  ["plus inside level", false, () => base("a/b+/c")],
  ["blank payload field", false, () => { const d = base(); d.payload.fields = [f("deviceId"), spec.blankField("")]; return d; }],
  ["integer payload field without example", false, () => { const d = base(); d.payload.fields = [f("count", "integer", "")]; return d; }],
  ["duplicate publishers", false, () => { const d = base(); d.publishers = ["센서", "센서"]; return d; }],
  ["publisher longer than 100", false, () => { const d = base(); d.publishers = ["가".repeat(101)]; return d; }],
  ["31 subscribers", false, () => { const d = base(); d.subscribers = Array.from({ length: 31 }, (_, i) => `s${i}`); return d; }],
  ["manual example with undefined key", false, () => { const d = base(); d.payload.fields = [f("deviceId", "string", "a")]; d.payload.exampleMode = "MANUAL"; d.payload.manualText = '{"deviceId":"a","extra":1}'; return d; }],
  ["new topic left empty", false, () => { const d = mqtt.blankMqtt(); d.changeReason = "x"; return d; }],
];

let failed = 0;
for (const [label, expectValid, make] of cases) {
  const issues = check.validateTopic(make());
  const ok = expectValid ? issues.length === 0 : issues.length > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const issue of issues) {
    console.log(`        [${issue.tab}] ${issue.where}: ${issue.message}`);
  }
}

// Client-only policy (not a server rule): unregistered actor input blocks save; duplicate paths only warn.
const listed = [
  { itemUid: "a", payload: { topic: "gateway/GW001/heartbeat" } },
  { itemUid: "b", payload: { topic: "gateway/GW001/event" } },
];
const policy = [
  ["pending actor input blocks save", check.pendingActorIssues({ publishers: " 센서 ", subscribers: "" }).length === 1],
  ["pending input on both fields reports both", check.pendingActorIssues({ publishers: "a", subscribers: "b" }).map((issue) => issue.target).join(",") === "mqtt:publishers,mqtt:subscribers"],
  ["blank actor input does not block", check.pendingActorIssues({ publishers: "  ", subscribers: "" }).length === 0],
  ["same path is reported as duplicate", check.duplicateTopics(listed, " gateway/GW001/heartbeat ", "new").length === 1],
  ["editing itself is not a duplicate", check.duplicateTopics(listed, "gateway/GW001/heartbeat", "a").length === 0],
  ["duplicate path does not fail validation", check.validateTopic(base("gateway/GW001/heartbeat")).length === 0],
];
for (const [label, ok] of policy) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} case(s) disagree with the expected server verdict`);
  process.exit(1);
}
