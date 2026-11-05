export function JsonBlock({ text }: { text: string }) {
  return <pre className="json-code">{tokenize(text).map((token, index) => <span key={index} className={token.kind}>{token.text}</span>)}</pre>;
}

function tokenize(text: string) {
  const tokens: { kind: string; text: string }[] = [];
  const pattern = /"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]|[^\s{}[\]:,"]+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: "", text: text.slice(cursor, start) });
    }
    let kind = "";
    if (value.startsWith("\"")) {
      const after = text.slice(start + value.length).match(/^\s*:/);
      kind = after ? "k" : "s";
    } else if (value === "true" || value === "false" || value === "null") {
      kind = "b";
    } else if (/^-?\d/.test(value)) {
      kind = "n";
    }
    tokens.push({ kind, text: value });
    cursor = start + value.length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "", text: text.slice(cursor) });
  }
  return tokens;
}
