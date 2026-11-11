function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(value: string) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  return html;
}

const tableSeparator = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(line: string) {
  const cells = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/);
  return cells.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function renderMarkdown(source: string, options: { rich?: boolean } = {}) {
  const rich = Boolean(options.rich);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      closeList();
      const language = rich ? line.slice(3).trim().replace(/[^a-z0-9-]/gi, "") : "";
      const block: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        block.push(escapeHtml(lines[index]));
        index += 1;
      }
      out.push(language
        ? `<pre data-lang="${language}"><code>${block.join("\n")}</code></pre>`
        : `<pre><code>${block.join("\n")}</code></pre>`);
      index += 1;
      continue;
    }
    if (rich && line.trim().startsWith("|") && index + 1 < lines.length && tableSeparator.test(lines[index + 1].trim())) {
      closeList();
      const head = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`
        + `<tbody>${rows.map((row) => `<tr>${head.map((_, cellIndex) => `<td>${inline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (rich && /^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      index += 1;
      continue;
    }
    const heading = (rich ? /^(#{1,4})\s+(.*)$/ : /^(#{1,3})\s+(.*)$/).exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((bullet ?? numbered)?.[1] ?? "")}</li>`);
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      closeList();
      index += 1;
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    index += 1;
  }
  closeList();
  return out.join("\n");
}
