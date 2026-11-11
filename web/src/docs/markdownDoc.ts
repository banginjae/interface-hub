// Parses Markdown into a plain tree that MarkdownView renders as React elements. Raw HTML is
// never interpreted: it stays text, and every link or image URL passes an allow-list first.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string | null; raw: string; children: Inline[] }
  | { kind: "image"; src: string | null; raw: string; alt: string }
  | { kind: "break" };

export type ListItem = { task: boolean | null; children: Block[] };
export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; level: number; id: string; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "hr" };

const fenceOpen = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const thematicBreak = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const quoteLine = /^ {0,3}>[ ]?/;
const listMarker = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const tableSeparator = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

// Only these URL forms ever reach an href or src attribute.
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith("#")) {
    return value.length > 1 ? value : null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value.replace(/[\u0000-\u0020\u007f-\u009f]/g, ""));
  if (!scheme) {
    return null;
  }
  const name = scheme[1].toLowerCase();
  if (name === "mailto") {
    return /^mailto:[^\s<>"]+$/i.test(value) ? value : null;
  }
  return name === "http" || name === "https" ? absoluteHttp(value) : null;
}

export function safeImageSrc(raw: string): string | null {
  const value = raw.trim();
  return /^https?:\/\//i.test(value) ? absoluteHttp(value) : null;
}

function absoluteHttp(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function markdownFilename(title: string) {
  const base = title
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 120)
    .trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base);
  return `${base && !reserved ? base : "document"}.md`;
}

export function headingSlug(text: string) {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return slug || "section";
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").split("\n").map(expandTabs);
  const used = new Map<string, number>();
  const blocks = parseBlocks(lines);
  assignHeadingIds(blocks, used);
  return blocks;
}

function expandTabs(line: string) {
  return line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length));
}

function assignHeadingIds(blocks: Block[], used: Map<string, number>) {
  for (const block of blocks) {
    if (block.kind === "heading") {
      const base = headingSlug(inlineText(block.children));
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      block.id = count === 0 ? base : `${base}-${count}`;
    } else if (block.kind === "quote") {
      assignHeadingIds(block.children, used);
    } else if (block.kind === "list") {
      block.items.forEach((item) => assignHeadingIds(item.children, used));
    }
  }
}

export function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => {
    if (node.kind === "text" || node.kind === "code") return node.text;
    if (node.kind === "image") return node.alt;
    if (node.kind === "break") return " ";
    return inlineText(node.children);
  }).join("");
}

function isBlank(line: string) {
  return line.trim() === "";
}

function startsBlock(line: string, next: string | undefined, inParagraph: boolean) {
  if (fenceOpen.test(line) || atxHeading.test(line) || thematicBreak.test(line) || quoteLine.test(line)) {
    return true;
  }
  const marker = listMarker.exec(line);
  if (marker && marker[4].trim() !== "") {
    const ordered = /\d/.test(marker[2]);
    if (!inParagraph || !ordered || /^1[.)]$/.test(marker[2])) {
      return true;
    }
  }
  return isTableStart(line, next);
}

function isTableStart(line: string, next: string | undefined) {
  if (!line.includes("|") || next === undefined || !next.includes("-") || !tableSeparator.test(next)) {
    return false;
  }
  return splitRow(line).length === splitRow(next).length;
}

function splitRow(line: string) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "`") {
      inCode = !inCode;
      current += char;
    } else if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = fenceOpen.exec(line);
    if (fence) {
      const marker = fence[1];
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = lines[index].trim();
        if (closing.startsWith(marker[0].repeat(marker.length)) && /^([`~])\1*$/.test(closing) && closing[0] === marker[0]) {
          index += 1;
          break;
        }
        body.push(lines[index].replace(new RegExp(`^ {0,${indent}}`), ""));
        index += 1;
      }
      blocks.push({ kind: "code", lang: fence[2].replace(/[^\w#+.-]/g, "").slice(0, 30), text: body.join("\n") });
      continue;
    }

    const heading = atxHeading.exec(line);
    if (heading) {
      const text = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").replace(/^#+$/, "");
      blocks.push({ kind: "heading", level: heading[1].length, id: "", children: parseInline(text) });
      index += 1;
      continue;
    }

    if (thematicBreak.test(line)) {
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }

    if (quoteLine.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && !isBlank(lines[index])) {
        const current = lines[index];
        if (quoteLine.test(current)) {
          inner.push(current.replace(quoteLine, ""));
        } else if (inner.length > 0 && !startsBlock(current, lines[index + 1], true)) {
          inner.push(current);
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({ kind: "quote", children: parseBlocks(inner) });
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[index + 1]).map((cell): Align => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && !isBlank(lines[index]) && lines[index].includes("|")) {
        const cells = splitRow(lines[index]);
        rows.push(head.map((_, cell) => parseInline(cells[cell] ?? "")));
        index += 1;
      }
      blocks.push({ kind: "table", align, head: head.map((cell) => parseInline(cell)), rows });
      continue;
    }

    const marker = listMarker.exec(line);
    if (marker) {
      index = parseList(lines, index, blocks);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    let setext = 0;
    while (index < lines.length && !isBlank(lines[index])) {
      const current = lines[index];
      if (/^ {0,3}=+[ \t]*$/.test(current)) {
        setext = 1;
        index += 1;
        break;
      }
      if (/^ {0,3}-+[ \t]*$/.test(current)) {
        setext = 2;
        index += 1;
        break;
      }
      if (startsBlock(current, lines[index + 1], true)) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    if (setext) {
      blocks.push({ kind: "heading", level: setext, id: "", children: parseInline(paragraph.map((part) => part.trim()).join(" ")) });
    } else {
      blocks.push({ kind: "paragraph", children: paragraphInline(paragraph) });
    }
  }
  return blocks;
}

// Line breaks inside a paragraph are kept, so pasted plain text reads the way it was written.
function paragraphInline(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, position) => {
    out.push(...parseInline(line.trim().replace(/\\$/, "")));
    if (position < lines.length - 1) {
      out.push({ kind: "break" });
    }
  });
  return out;
}

function parseList(lines: string[], start: number, blocks: Block[]) {
  const first = listMarker.exec(lines[start]);
  if (!first) return start + 1;
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const items: ListItem[] = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker.exec(lines[index]);
    if (!marker || marker[1].length !== baseIndent || /\d/.test(marker[2]) !== ordered) {
      break;
    }
    const contentIndent = marker[1].length + marker[2].length + Math.min(Math.max(marker[3].length, 1), 4);
    const body: string[] = [marker[4]];
    index += 1;
    while (index < lines.length) {
      const current = lines[index];
      if (isBlank(current)) {
        const next = lines.slice(index + 1).find((candidate) => !isBlank(candidate));
        const nextIndent = next ? next.length - next.trimStart().length : 0;
        if (next !== undefined && nextIndent >= contentIndent) {
          body.push("");
          index += 1;
          continue;
        }
        break;
      }
      const indent = current.length - current.trimStart().length;
      if (indent >= contentIndent) {
        body.push(current.slice(contentIndent));
      } else if (indent > baseIndent && listMarker.test(current)) {
        body.push(current.slice(Math.min(indent, contentIndent)));
      } else if (!listMarker.test(current) && !startsBlock(current, lines[index + 1], true) && !isBlank(body[body.length - 1] ?? "")) {
        body.push(current.trim());
      } else {
        break;
      }
      index += 1;
    }
    let task: boolean | null = null;
    const check = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (check) {
      task = check[1] !== " ";
      body[0] = body[0].slice(check[0].length);
    }
    items.push({ task, children: parseBlocks(body) });
    const after = index;
    while (index < lines.length && isBlank(lines[index])) index += 1;
    const following = index < lines.length ? listMarker.exec(lines[index]) : null;
    if (!following || following[1].length !== baseIndent || /\d/.test(following[2]) !== ordered) {
      index = after;
      break;
    }
  }
  blocks.push({ kind: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) || 1 : 1, items });
  return index;
}

const punctuation = /[!-/:-@[-`{-~]/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const rest = text.slice(index);

    if (char === "\\" && index + 1 < text.length && punctuation.test(text[index + 1])) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (char === "`") {
      const run = /^`+/.exec(rest)?.[0] ?? "`";
      const close = findCodeClose(text, index + run.length, run.length);
      if (close >= 0) {
        flush();
        let code = text.slice(index + run.length, close);
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        out.push({ kind: "code", text: code });
        index = close + run.length;
        continue;
      }
      buffer += run;
      index += run.length;
      continue;
    }

    if (char === "!" && text[index + 1] === "[") {
      const link = readLink(text, index + 1);
      if (link) {
        flush();
        out.push({ kind: "image", src: safeImageSrc(link.dest), raw: link.dest, alt: inlineText(parseInline(link.label)) });
        index = link.end;
        continue;
      }
    }

    if (char === "[") {
      const link = readLink(text, index);
      if (link) {
        flush();
        out.push({ kind: "link", href: safeHref(link.dest), raw: link.dest, children: parseInline(link.label) });
        index = link.end;
        continue;
      }
    }

    if (char === "<") {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(rest);
      if (auto) {
        flush();
        out.push({ kind: "link", href: safeHref(auto[1]), raw: auto[1], children: [{ kind: "text", text: auto[1].replace(/^mailto:/i, "") }] });
        index += auto[0].length;
        continue;
      }
    }

    if ((char === "h" || char === "H") && !/[\p{L}\p{N}]/u.test(text[index - 1] ?? "")) {
      const bare = /^https?:\/\/[^\s<>]+/i.exec(rest);
      if (bare) {
        const url = trimUrl(bare[0]);
        flush();
        out.push({ kind: "link", href: safeHref(url), raw: url, children: [{ kind: "text", text: url }] });
        index += url.length;
        continue;
      }
    }

    if (char === "~" && rest.startsWith("~~")) {
      const close = text.indexOf("~~", index + 2);
      if (close > index + 2) {
        flush();
        out.push({ kind: "del", children: parseInline(text.slice(index + 2, close)) });
        index = close + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const emphasis = readEmphasis(text, index);
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        index = emphasis.end;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
  return out;
}

function findCodeClose(text: string, from: number, size: number) {
  let index = from;
  while (index < text.length) {
    const next = text.indexOf("`", index);
    if (next < 0) return -1;
    const run = /^`+/.exec(text.slice(next))?.[0].length ?? 1;
    if (run === size) return next;
    index = next + run;
  }
  return -1;
}

function readLink(text: string, open: number) {
  let depth = 0;
  let close = -1;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "`") {
      const run = /^`+/.exec(text.slice(index))?.[0].length ?? 1;
      const end = findCodeClose(text, index + run, run);
      if (end >= 0) index = end + run - 1;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  let index = close + 2;
  while (text[index] === " ") index += 1;
  let dest = "";
  if (text[index] === "<") {
    const end = text.indexOf(">", index);
    if (end < 0) return null;
    dest = text.slice(index + 1, end);
    index = end + 1;
  } else {
    let parens = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === " " || char === "\t") break;
      if (char === "(") parens += 1;
      if (char === ")") {
        if (parens === 0) break;
        parens -= 1;
      }
      dest += char;
      index += 1;
    }
  }
  while (text[index] === " ") index += 1;
  if (text[index] === "\"" || text[index] === "'") {
    const quote = text[index];
    const end = text.indexOf(quote, index + 1);
    if (end < 0) return null;
    index = end + 1;
    while (text[index] === " ") index += 1;
  }
  if (text[index] !== ")") return null;
  return { label: text.slice(open + 1, close), dest, end: index + 1 };
}

function trimUrl(url: string) {
  let value = url.replace(/[.,;:!?'"*_~]+$/, "");
  while (value.endsWith(")") && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) {
    value = value.slice(0, -1);
  }
  return value;
}

function readEmphasis(text: string, index: number): { node: Inline; end: number } | null {
  const char = text[index];
  const before = text[index - 1] ?? "";
  if (char === "_" && /[\p{L}\p{N}]/u.test(before)) return null;
  const double = text[index + 1] === char;
  const size = double ? 2 : 1;
  const delimiter = char.repeat(size);
  const open = index + size;
  if (/\s/.test(text[open] ?? " ")) return null;
  let search = open;
  while (search < text.length) {
    const close = text.indexOf(delimiter, search);
    if (close < 0) return null;
    const inner = text.slice(open, close);
    const after = text[close + size] ?? "";
    const tooLong = !double && text[close + 1] === char;
    const closingOk = inner.length > 0 && !/\s/.test(text[close - 1]) && !(char === "_" && /[\p{L}\p{N}]/u.test(after));
    if (closingOk && !tooLong) {
      return { node: { kind: double ? "strong" : "em", children: parseInline(inner) }, end: close + size };
    }
    search = close + (tooLong ? 2 : size);
  }
  return null;
}

export function unsupportedImages(blocks: Block[]): string[] {
  const found: string[] = [];
  const visitInline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.kind === "image" && !node.src) found.push(node.raw || node.alt);
      else if (node.kind === "strong" || node.kind === "em" || node.kind === "del" || node.kind === "link") visitInline(node.children);
    }
  };
  const visit = (list: Block[]) => {
    for (const block of list) {
      if (block.kind === "heading" || block.kind === "paragraph") visitInline(block.children);
      else if (block.kind === "quote") visit(block.children);
      else if (block.kind === "list") block.items.forEach((item) => visit(item.children));
      else if (block.kind === "table") [...block.head, ...block.rows.flat()].forEach(visitInline);
    }
  };
  visit(blocks);
  return found;
}
