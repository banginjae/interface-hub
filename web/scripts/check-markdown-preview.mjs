// Renders Markdown shaped like internal/service/markdown.go output and checks the
// preview HTML: tables, code blocks, headings, and that raw HTML stays escaped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "markdown-preview");
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(path.join(web, "src/docs/markdownPreview.ts"), "utf8");
fs.writeFileSync(path.join(out, "markdownPreview.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
const { renderMarkdown } = await import(new URL(`file:///${path.join(out, "markdownPreview.mjs").replace(/\\/g, "/")}`).href);

const sample = [
  "# 포장 라인 — API 규격",
  "",
  "- 버전: 3",
  "- Base URL: https://api.example.com",
  "",
  "### 공통 헤더",
  "",
  "없습니다.",
  "",
  "## Endpoint 목록",
  "",
  "- `POST /api/v1/auth/login` — 로그인",
  "",
  "## POST /api/v1/auth/login",
  "",
  "<script>alert(1)</script> 설명 <img src=x onerror=alert(2)>",
  "",
  "### Request Body",
  "",
  "| 이름 | 타입 | 필수 | 설명 | 예시 |",
  "| --- | --- | --- | --- | --- |",
  "| loginId | string | 예 | 사번 \\| 아이디 | user01 |",
  "| user.roles[] | string | 아니오 | <b>역할</b> | ADMIN |",
  "",
  "```json",
  "{",
  "  \"loginId\": \"user01\"",
  "}",
  "```",
  "",
  "---",
  "",
  "[링크](javascript:alert(3))",
].join("\n");

const html = renderMarkdown(sample, { rich: true });
const plain = renderMarkdown(sample);
const checks = [
  ["h1 rendered", html.includes("<h1>포장 라인 — API 규격</h1>")],
  ["endpoint h2 rendered", html.includes("<h2>POST /api/v1/auth/login</h2>")],
  ["h3 rendered", html.includes("<h3>Request Body</h3>")],
  ["table rendered", html.includes('<div class="md-table"><table><thead><tr><th>이름</th>')],
  ["escaped pipe kept in one cell", html.includes("<td>사번 | 아이디</td>")],
  ["json code block", html.includes('<pre data-lang="json"><code>{')],
  ["inline code", html.includes("<code>POST /api/v1/auth/login</code>")],
  ["list", html.includes("<li>버전: 3</li>")],
  ["horizontal rule", html.includes("<hr>")],
  ["script tag escaped", !html.includes("<script") && html.includes("&lt;script&gt;")],
  ["img tag escaped", !html.includes("<img") && html.includes("&lt;img")],
  ["html in table escaped", !html.includes("<b>") && html.includes("&lt;b&gt;역할&lt;/b&gt;")],
  ["javascript link not linked", !html.includes('href="javascript')],
  ["general docs output unchanged (no tables without rich)", !plain.includes("<table") && !plain.includes("<hr>")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  process.exit(1);
}
