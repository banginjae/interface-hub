import { useEffect, useState } from "react";
import { appConfig } from "../appConfig";
import { usePageChrome } from "../Shell";

type Health = {
  status: string;
};

type View =
  | { state: "loading" }
  | { state: "ok"; body: string }
  | { state: "error"; body: string };

export function HealthPage() {
  const [view, setView] = useState<View>({ state: "loading" });
  usePageChrome("시스템 상태", [{ label: "상태" }]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.text();
        if (!response.ok) {
          setView({ state: "error", body });
          return;
        }
        const parsed = JSON.parse(body) as Health;
        if (parsed.status !== "ok") {
          setView({ state: "error", body });
          return;
        }
        setView({ state: "ok", body });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setView({ state: "error", body: "API 서버에 연결하지 못했습니다." });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{appConfig.serviceName}</h1>
          <p className="lede">서버 연결 확인</p>
        </div>
      </div>
      {view.state === "loading" ? <p className="state-panel">확인 중입니다.</p> : null}
      {view.state === "ok" ? <p className="banner success">상태: 정상 <code>{view.body}</code></p> : null}
      {view.state === "error" ? <p className="banner danger">상태: 확인 실패. {view.body}</p> : null}
    </main>
  );
}
