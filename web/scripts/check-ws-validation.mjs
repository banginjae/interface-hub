// Runs the WebSocket message validator against drafts whose server verdict is pinned in
// internal/service/wsschema_ux_test.go, so client and server rules stay aligned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "ws-validation");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "restValidation", "wsModel", "wsValidation"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (name) => import(new URL(`file:///${path.join(out, `${name}.mjs`).replace(/\\/g, "/")}`).href);
const spec = await load("specModel");
const ws = await load("wsModel");
const check = await load("wsValidation");

function base(eventName = "doorlock.open") {
  const draft = ws.blankWs();
  draft.eventName = eventName;
  draft.name = "도어락 열기 요청";
  draft.changeReason = "test";
  return draft;
}
function f(name, type = "string", example = "") {
  return Object.assign(spec.blankField(name), { type, example });
}

const messages = [
  ["valid: dotted identifier with field", true, () => { const d = base(); d.payload.fields = [f("doorlockId", "string", "DL001")]; return d; }],
  ["valid: leading underscore", true, () => base("_internal.ping")],
  ["valid: leading hyphen", true, () => base("-legacy")],
  ["valid: mixed separators", true, () => base("gateway.status_changed-v2")],
  ["valid: no payload fields", true, () => base("session.ready")],
  ["empty identifier", false, () => base("")],
  ["space in identifier", false, () => base("doorlock open")],
  ["leading dot", false, () => base(".doorlock")],
  ["trailing dot", false, () => base("doorlock.")],
  ["double dot", false, () => base("doorlock..open")],
  ["korean identifier", false, () => base("도어락")],
  ["slash in identifier", false, () => base("doorlock/open")],
  ["identifier longer than 200", false, () => base("a".repeat(201))],
  ["blank payload field", false, () => { const d = base(); d.payload.fields = [f("doorlockId"), spec.blankField("")]; return d; }],
  ["integer field without example", false, () => { const d = base(); d.payload.fields = [f("count", "integer", "")]; return d; }],
  ["manual example with undefined key", false, () => { const d = base(); d.payload.fields = [f("doorlockId", "string", "a")]; d.payload.exampleMode = "MANUAL"; d.payload.manualText = '{"doorlockId":"a","extra":1}'; return d; }],
  ["malformed related uid", false, () => { const d = base(); d.relatedItemUid = "abc"; return d; }],
];

function overview(edit) {
  const o = { title: "WebSocket 규격", url: "wss://lab.example/ws", heartbeat: "", authType: "NONE", authDescription: "", closeCodes: [], changeReason: "x" };
  edit?.(o);
  return o;
}
const overviews = [
  ["valid overview with close codes", true, () => overview((o) => { o.closeCodes = [{ code: "1000", description: "정상" }, { code: "4001", description: "인증 만료" }]; })],
  ["close code above 4999", false, () => overview((o) => { o.closeCodes = [{ code: "5000", description: "" }]; })],
  ["duplicate close code", false, () => overview((o) => { o.closeCodes = [{ code: "4001", description: "" }, { code: "4001", description: "" }]; })],
  ["close code description over 200", false, () => overview((o) => { o.closeCodes = [{ code: "4001", description: "가".repeat(201) }]; })],
  ["space in url", false, () => overview((o) => { o.url = "wss://lab example/ws"; })],
];

let failed = 0;
function run(label, expectValid, issues) {
  const ok = expectValid ? issues.length === 0 : issues.length > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const issue of issues) {
    console.log(`        [${issue.tab ?? "문서"}] ${issue.where}: ${issue.message}`);
  }
}
for (const [label, expectValid, make] of messages) run(label, expectValid, check.validateMessage(make(), "new"));
for (const [label, expectValid, make] of overviews) run(label, expectValid, check.validateWsOverview(make()));

const selfUid = "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10";
const self = base();
self.relatedItemUid = selfUid;
run("client: self link is rejected (server repository rule)", false, check.validateMessage(self, selfUid));
run("client: new message without identifier", false, check.validateMessage(Object.assign(ws.blankWs(), { changeReason: "x" }), "new"));

// Minimum input: identifier only. The server requires a non-empty item name, so the page sends the
// identifier as the name when it is blank (messageName), and an empty payload is accepted.
const minimal = Object.assign(ws.blankWs(), { eventName: "session.ready" });
run("client: identifier only (name, payload, related left empty)", true, check.validateMessage(minimal, "new"));
const sent = ws.messageName(minimal) === "session.ready" && ws.wsToPayload(minimal).fields.length === 0;
if (!sent) failed += 1;
console.log(`${sent ? "PASS" : "FAIL"}  client: blank name is sent as the identifier, payload fields stay empty`);
const defaults = minimal.direction === "CLIENT_TO_SERVER" && minimal.messageKind === "EVENT";
if (!defaults) failed += 1;
console.log(`${defaults ? "PASS" : "FAIL"}  client: new message keeps the original defaults (CLIENT_TO_SERVER, EVENT)`);

const listed = [
  { itemUid: "a", name: "열기", payload: { eventName: "doorlock.open" } },
  { itemUid: "b", name: "결과", payload: { eventName: "doorlock.open.result" } },
];
for (const [label, ok] of [
  ["client: same identifier is reported as duplicate", check.duplicateEventNames(listed, " doorlock.open ", "new").length === 1],
  ["client: editing itself is not a duplicate", check.duplicateEventNames(listed, "doorlock.open", "a").length === 0],
  ["client: duplicate identifier does not block validation", check.validateMessage(base("doorlock.open"), "new").length === 0],
]) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} case(s) disagree with the expected server verdict`);
  process.exit(1);
}
