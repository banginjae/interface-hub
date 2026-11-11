// Runs the error code form validator against drafts whose server verdict is pinned in
// internal/service/errorcode_ux_test.go, so client and server rules stay aligned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "errorcode-validation");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "restValidation", "errorCodeValidation"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const check = await import(new URL(`file:///${path.join(out, "errorCodeValidation.mjs").replace(/\\/g, "/")}`).href);

const base = (edit) => {
  const draft = { code: "E_TIMEOUT", category: "통신", description: "응답 시간 초과", conditionText: "", handling: "", changeReason: "test" };
  edit?.(draft);
  return draft;
};
const cases = [
  ["code, category and description only", true, base()],
  ["hex style code", true, base((d) => { d.code = "0x3030"; })],
  ["lowercase code is kept as typed", true, base((d) => { d.code = "auth_failed"; })],
  ["korean code", true, base((d) => { d.code = "인증실패"; })],
  ["64 character code", true, base((d) => { d.code = "A".repeat(64); })],
  ["condition and handling filled", true, base((d) => { d.conditionText = "3초 동안 응답 없음"; d.handling = "재시도"; })],
  ["empty code", false, base((d) => { d.code = ""; })],
  ["space in code", false, base((d) => { d.code = "E TIMEOUT"; })],
  ["tab in code", false, base((d) => { d.code = "E\tTIMEOUT"; })],
  ["65 character code", false, base((d) => { d.code = "A".repeat(65); })],
  ["empty category", false, base((d) => { d.category = " "; })],
  ["category over 100", false, base((d) => { d.category = "가".repeat(101); })],
  ["empty description", false, base((d) => { d.description = ""; })],
  ["description over 4000", false, base((d) => { d.description = "가".repeat(4001); })],
  ["handling over 4000", false, base((d) => { d.handling = "가".repeat(4001); })],
];

let failed = 0;
for (const [label, expectValid, draft] of cases) {
  const issues = check.validateErrorCode(draft, [], null);
  const ok = expectValid ? issues.length === 0 : issues.length > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const issue of issues) console.log(`        ${issue.where}: ${issue.message}`);
}

// Duplicate rule mirrors the active-code unique key, which compares with a case-insensitive collation.
const rows = [{ id: 1, code: "E_TIMEOUT" }, { id: 2, code: "AUTH_FAILED" }];
for (const [label, ok] of [
  ["client: same code is rejected before the server returns ERROR_CODE_TAKEN", check.validateErrorCode(base(), rows, null).length === 1],
  ["client: case-only difference is also a duplicate", check.validateErrorCode(base((d) => { d.code = "e_timeout"; }), rows, null).length === 1],
  ["client: editing itself is not a duplicate", check.validateErrorCode(base(), rows, 1).length === 0],
]) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} case(s) disagree with the expected server verdict`);
  process.exit(1);
}
