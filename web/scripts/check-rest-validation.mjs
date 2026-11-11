// Runs the REST editor validator against drafts whose server verdict is pinned in
// internal/service/apischema_ux_test.go, so client and server rules stay aligned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "rest-validation");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "restValidation"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/specModel"/g, 'from "./specModel.mjs"'));
}
const m = await import(new URL(`file:///${path.join(out, "specModel.mjs").replace(/\\/g, "/")}`).href);
const v = await import(new URL(`file:///${path.join(out, "restValidation.mjs").replace(/\\/g, "/")}`).href);

function base() {
  const d = m.blankItem();
  d.changeReason = "test";
  d.path = "/api/v1/auth/login";
  d.name = "login";
  return d;
}
function f(name, type = "string", example = "", extra = {}) {
  return Object.assign(m.blankField(name), { type, example }, extra);
}

const cases = [
  ["valid: two strings and response 200", true, () => { const d = base(); d.requestBody.fields = [f("loginId", "string", "user01"), f("password", "string", "secret")]; d.responses[0].fields = [f("accessToken", "string", "abc")]; return d; }],
  ["valid: GET without request body", true, () => { const d = base(); d.method = "GET"; return d; }],
  ["valid: enum with example", true, () => { const d = base(); d.requestBody.fields = [f("state", "enum", "ACTIVE", { enumText: "ACTIVE, INACTIVE" })]; return d; }],
  ["blank row in request body", false, () => { const d = base(); d.requestBody.fields = [f("loginId"), m.blankField("")]; return d; }],
  ["blank row in header tab", false, () => { const d = base(); d.requestBody.fields = [f("loginId")]; d.headers = [m.blankField("")]; return d; }],
  ["blank row in response 200", false, () => { const d = base(); d.requestBody.fields = [f("loginId")]; d.responses[0].fields = [m.blankField("")]; return d; }],
  ["space in field name", false, () => { const d = base(); d.requestBody.fields = [f("login Id")]; return d; }],
  ["brace in field name", false, () => { const d = base(); d.requestBody.fields = [f("{id}")]; return d; }],
  ["integer header without example", false, () => { const d = base(); d.headers = [f("X-Count", "integer", "")]; return d; }],
  ["boolean query without example", false, () => { const d = base(); d.queryParams = [f("all", "boolean", "")]; return d; }],
  ["enum without values", false, () => { const d = base(); d.requestBody.fields = [f("state", "enum", "")]; return d; }],
  ["blank child inside object", false, () => { const d = base(); d.requestBody.fields = [f("user", "object", "", { children: [f("id"), m.blankField("")] })]; return d; }],
  ["array of integer without example", false, () => { const d = base(); d.requestBody.fields = [f("ids", "array", "", { arrayItem: f("item", "integer", "") })]; return d; }],
  ["duplicate response status", false, () => { const d = base(); d.responses.push(m.blankResponse("200")); return d; }],
  ["new endpoint left empty", false, () => { const d = m.blankItem(); d.changeReason = "x"; return d; }],
];

let failed = 0;
for (const [label, expectValid, make] of cases) {
  const issues = v.validateItem(make());
  const ok = expectValid ? issues.length === 0 : issues.length > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const issue of issues) {
    console.log(`        [${issue.tab ?? "기본 정보"}] ${issue.where}: ${issue.message}`);
  }
}
fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} case(s) disagree with the expected server verdict`);
  process.exit(1);
}
