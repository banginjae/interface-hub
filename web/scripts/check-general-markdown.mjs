// Renders general document Markdown through the real MarkdownView component and checks the
// supported syntax, that untrusted HTML and URLs never become markup, and download filenames.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "general-markdown");
fs.mkdirSync(out, { recursive: true });
for (const [name, ext] of [["markdownDoc", "ts"], ["MarkdownView", "tsx"]]) {
  const source = fs.readFileSync(path.join(web, "src/docs", `${name}.${ext}`), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (name) => import(new URL(`file:///${path.join(out, `${name}.mjs`).replace(/\\/g, "/")}`).href);
const { markdownFilename, parseMarkdown, safeHref, unsupportedImages } = await load("markdownDoc");
const { MarkdownView } = await load("MarkdownView");
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const html = (source) => renderToStaticMarkup(React.createElement(MarkdownView, { source }));

const sample = [
  "# 설치 가이드",
  "## 준비",
  "### 셋",
  "#### 넷",
  "##### 다섯",
  "###### 여섯",
  "",
  "일반 문단에 **굵게**, *기울임*, ~~취소선~~, `inline()` 코드.",
  "다음 줄도 같은 문단입니다.",
  "",
  "- 항목 A",
  "  - 중첩 항목",
  "- 항목 B",
  "",
  "1. 첫째",
  "2. 둘째",
  "",
  "- [ ] 할 일",
  "- [x] 끝난 일",
  "",
  "> 인용문 **강조**",
  "",
  "```bash",
  "echo \"<b>not html</b>\"",
  "```",
  "",
  "| 이름 | 값 |",
  "| :--- | ---: |",
  "| a \\| b | `x|y` |",
  "",
  "---",
  "",
  "[문서](https://example.com/a?b=1) · <https://example.com/auto> · https://example.com/bare.",
  "![로고](https://example.com/logo.png) ![로컬](./img/local.png)",
  "[목차로](#준비)",
].join("\n");
const rendered = html(sample);

const attack = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(2)>",
  "[js](javascript:alert(3)) [js2](JaVaScRiPt:alert(4)) [js3](java\tscript:alert(5)) [data](data:text/html,<script>alert(6)</script>)",
  "[vb](vbscript:msgbox(7)) [file](file:///etc/passwd) [rel](../secret.md) [proto](//evil.example)",
  "![x](javascript:alert(8)) ![y](data:image/svg+xml,<svg onload=alert(9)>)",
  "<a href=\"javascript:alert(10)\">raw</a> <iframe src=\"https://evil.example\"></iframe>",
  "| <b onclick=alert(11)>cell</b> | x |",
  "| --- | --- |",
  "| <svg/onload=alert(12)> | y |",
  "",
  "```html",
  "<script>alert(13)</script>",
  "```",
].join("\n");
const attacked = html(attack);

const checks = [
  ["h1~h6", ["h1", "h2", "h3", "h4", "h5", "h6"].every((tag) => rendered.includes(`<${tag} id=`))],
  ["bold / italic / strike", rendered.includes("<strong>굵게</strong>") && rendered.includes("<em>기울임</em>") && rendered.includes("<del>취소선</del>")],
  ["inline code", rendered.includes("<code>inline()</code>")],
  ["paragraph keeps line breaks", rendered.includes("코드.<br/>다음 줄도")],
  ["nested bullet list", /<ul><li>항목 A<ul><li>중첩 항목<\/li><\/ul><\/li><li>항목 B<\/li><\/ul>/.test(rendered)],
  ["ordered list", rendered.includes("<ol><li>첫째</li><li>둘째</li></ol>")],
  ["checklist", rendered.includes('type="checkbox" disabled=""') && rendered.includes('checked=""')],
  ["blockquote", rendered.includes("<blockquote><p>인용문 <strong>강조</strong></p></blockquote>")],
  ["code block with language and copy button", rendered.includes("<span>bash</span><button") && rendered.includes("echo &quot;&lt;b&gt;not html&lt;/b&gt;&quot;")],
  ["table in scroll wrapper", rendered.includes('class="doc-md-table"') && rendered.includes("<th style=\"text-align:left\">이름</th>")],
  ["table escaped pipe and pipe in code", rendered.includes(">a | b</td>") && rendered.includes("<code>x|y</code>")],
  ["horizontal rule", rendered.includes("<hr/>")],
  ["external links open safely", rendered.includes('href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow"')],
  ["autolink and bare url", rendered.includes('href="https://example.com/auto"') && rendered.includes('href="https://example.com/bare"')],
  ["https image", rendered.includes('<img src="https://example.com/logo.png" alt="로고" loading="lazy" referrerPolicy="no-referrer"/>')],
  ["relative image explained", rendered.includes("이미지 표시 안 됨: 로컬")],
  ["heading anchor link", rendered.includes('href="#준비"') && rendered.includes('id="md-준비"')],
  ["unsupported images reported", unsupportedImages(parseMarkdown(sample)).join() === "./img/local.png"],
  ["no script element", !/<script/i.test(attacked)],
  ["no img/iframe/svg/a from raw html", !/<(img|iframe|svg|b)\b/i.test(attacked) && !attacked.includes("<a href=\"javascript")],
  ["no event handler attributes", (attacked.match(/<[a-zA-Z][^>]*>/g) ?? []).every((tag) => !/\son\w+=/i.test(tag))],
  ["no dangerous href", !/href="(?!https?:|#|mailto:)/i.test(attacked) && !/javascript:|vbscript:|data:|file:/i.test((attacked.match(/href="[^"]*"/g) ?? []).join(" "))],
  ["no dangerous src", (attacked.match(/src="[^"]*"/g) ?? []).length === 0],
  ["raw html shown as text", attacked.includes("&lt;script&gt;alert(1)&lt;/script&gt;")],
  ["safeHref allow-list", safeHref("https://a.example") === "https://a.example/" && safeHref("mailto:a@b.c") === "mailto:a@b.c" && safeHref(" javascript:x") === null && safeHref("\u0001javascript:x") === null && safeHref("./a.md") === null],
  ["plain text document", html("첫 줄\n둘째 줄\n\n새 문단").includes("<p>첫 줄<br/>둘째 줄</p><p>새 문단</p>")],
  ["filename keeps korean", markdownFilename("설치 가이드 v2") === "설치 가이드 v2.md"],
  ["filename strips unsafe characters", markdownFilename('a/b\\c:d*e?f"g<h>i|j') === "a_b_c_d_e_f_g_h_i_j.md"],
  ["filename fallback", markdownFilename("  ...  ") === "document.md" && markdownFilename("CON") === "document.md"],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
if (failed > 0) {
  console.log("\n--- rendered ---\n" + rendered + "\n--- attacked ---\n" + attacked);
  process.exit(1);
}
