import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdownDoc";

export function MarkdownView({ source, className = "" }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className={`doc-md ${className}`.trim()}>{renderBlocks(blocks, "b")}</div>;
}

function renderBlocks(blocks: Block[], prefix: string): ReactNode[] {
  return blocks.map((block, index) => renderBlock(block, `${prefix}-${index}`));
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1";
      return <Tag key={key} id={`md-${block.id}`}>{renderInline(block.children, key)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children, key)}</p>;
    case "code":
      return <CodeBlock key={key} lang={block.lang} text={block.text} />;
    case "quote":
      return <blockquote key={key}>{renderBlocks(block.children, key)}</blockquote>;
    case "hr":
      return <hr key={key} />;
    case "list": {
      const items = block.items.map((item, index) => {
        const [first, ...rest] = item.children;
        const lead = first?.kind === "paragraph" ? renderInline(first.children, `${key}-${index}-p`) : first ? renderBlock(first, `${key}-${index}-0`) : null;
        return (
          <li key={`${key}-${index}`} className={item.task === null ? undefined : "is-task"}>
            {item.task === null ? null : <input type="checkbox" checked={item.task} disabled aria-label={item.task ? "완료" : "미완료"} />}
            {lead}
            {renderBlocks(rest, `${key}-${index}`)}
          </li>
        );
      });
      return block.ordered
        ? <ol key={key} start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul key={key} className={block.items.some((item) => item.task !== null) ? "is-tasks" : undefined}>{items}</ul>;
    }
    case "table":
      return (
        <div key={key} className="doc-md-table" tabIndex={0} role="region" aria-label="표">
          <table>
            <thead>
              <tr>{block.head.map((cell, index) => <th key={index} style={alignStyle(block.align[index])}>{renderInline(cell, `${key}-h${index}`)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={alignStyle(block.align[index])}>{renderInline(cell, `${key}-${rowIndex}-${index}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function alignStyle(align: string | null | undefined) {
  return align ? { textAlign: align as "left" | "center" | "right" } : undefined;
}

function renderInline(nodes: Inline[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "del":
        return <del key={key}>{renderInline(node.children, key)}</del>;
      case "break":
        return <br key={key} />;
      case "image":
        return node.src
          ? <img key={key} src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" />
          : <span key={key} className="doc-md-noimg" title={node.raw}>이미지 표시 안 됨: {node.alt || node.raw || "이름 없음"} · 외부 https 주소의 이미지만 표시합니다.</span>;
      case "link":
        if (!node.href) {
          return <span key={key} className="doc-md-badlink" title={`연결하지 않은 주소: ${node.raw}`}>{renderInline(node.children, key)}</span>;
        }
        if (node.href.startsWith("#")) {
          return <a key={key} href={node.href} onClick={(event) => jumpTo(event, node.href as string)}>{renderInline(node.children, key)}</a>;
        }
        return <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow">{renderInline(node.children, key)}</a>;
    }
  });
}

function jumpTo(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  const root = event.currentTarget.closest(".doc-md");
  const target = root?.querySelector<HTMLElement>(`#${CSS.escape(`md-${decodeURIComponent(href.slice(1)).toLowerCase()}`)}`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState<"" | "done" | "fail">("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("fail");
    }
    window.setTimeout(() => setCopied(""), 1600);
  }
  return (
    <div className="doc-md-code">
      <div className="doc-md-code-bar">
        <span>{lang || "code"}</span>
        <button type="button" onClick={() => void copy()}>{copied === "done" ? "복사됨" : copied === "fail" ? "복사 실패" : "복사"}</button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}
