import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { authErrorMessage } from "../auth";

export function SpecMarkdown({ projectId, token, version, kind = "API" }: { projectId: string; token: string; version: number; kind?: string }) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/specs/${kind}/markdown`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await response.text();
        if (!response.ok) {
          let parsed: { message?: string } = {};
          try {
            parsed = JSON.parse(body) as { message?: string };
          } catch {
            parsed = {};
          }
          throw new ApiError(response.status, parsed.message || "Markdown을 받지 못했습니다.");
        }
        if (cancel) {
          return;
        }
        setText(body);
        const encoded = response.headers.get("X-Markdown-Filename") || "";
        let decoded = encoded;
        try {
          decoded = encoded ? decodeURIComponent(encoded) : "";
        } catch {
          decoded = encoded;
        }
        setFilename(decoded || `API-v${version}.md`);
        setMessage("");
      })
      .catch((error: unknown) => {
        if (!cancel) {
          setMessage(authErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancel) {
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [projectId, token, version, kind]);

  async function copyText() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithSelection(text);
      }
      setMessage("Markdown을 복사했습니다.");
    } catch {
      try {
        copyWithSelection(text);
        setMessage("Markdown을 복사했습니다.");
      } catch {
        setMessage("복사하지 못했습니다. 미리보기에서 직접 선택할 수 있습니다.");
      }
    }
  }

  function copyWithSelection(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) {
    throw new Error("copy failed");
  }
}

function download() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `API-v${version}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown 파일을 저장했습니다.");
  }

  if (loading) {
    return <p className="state-panel">Markdown을 만드는 중입니다.</p>;
  }
  if (!text) {
    return <p className="banner danger">{message || "Markdown이 없습니다."}</p>;
  }
  return (
    <section className="markdown-screen">
      <div className="inline-actions">
        <button type="button" className="btn primary" onClick={() => void copyText()}>Markdown 복사</button>
        <button type="button" onClick={download}>파일 다운로드</button>
        <span className="section-empty">{filename} · 문서 버전 {version}</span>
      </div>
      {message ? <p className={message.includes("못했습니다") || message.includes("받지") ? "banner danger" : "banner success"}>{message}</p> : null}
      <h2>미리보기</h2>
      <p className="section-empty">마지막 저장본입니다. 편집 중인 내용은 포함하지 않습니다.</p>
      <pre className="markdown-preview">{text}</pre>
    </section>
  );
}
