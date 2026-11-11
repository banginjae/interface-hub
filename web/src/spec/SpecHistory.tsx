import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage } from "../auth";
import { buildCompareReport, type CompareReport, type SnapshotDocument } from "./compareReport";

type Revision = {
  version: number;
  changeReason: string;
  actor: { id: number; name: string };
  createdAt: string;
  summary: { op?: string; itemUid?: string; name?: string };
};

export function SpecHistory({ projectId, token, kind = "API", heading = "변경 이력" }: { projectId: string; token: string; kind?: string; heading?: string | null }) {
  const noun = kind === "MQTT" ? "Topic" : kind === "WEBSOCKET" ? "메시지" : kind === "DEVICE_PROTOCOL" ? "명령" : "Endpoint";
  const operations: Record<string, string> = {
    CREATE_DOCUMENT: "문서 생성",
    CREATE_ITEM: `${noun} 추가`,
    UPDATE_ITEM: `${noun} 수정`,
    DELETE_ITEM: `${noun} 삭제`,
    REORDER_ITEMS: "순서 변경",
    UPDATE_OVERVIEW: "문서 개요 변경",
  };
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [fromVersion, setFromVersion] = useState(0);
  const [toVersion, setToVersion] = useState(0);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    apiRequest<{ revisions: Revision[] }>(`/api/projects/${projectId}/specs/${kind}/revisions`, { token })
      .then((result) => {
        if (cancel) {
          return;
        }
        const rows = result.revisions ?? [];
        setRevisions(rows);
        if (rows.length >= 2) {
          setToVersion(rows[0].version);
          setFromVersion(rows[1].version);
        }
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
  }, [projectId, token, kind]);

  useEffect(() => {
    if (!fromVersion || !toVersion || fromVersion === toVersion) {
      setReport(null);
      return;
    }
    let cancel = false;
    apiRequest<{ before: SnapshotDocument; after: SnapshotDocument }>(
      `/api/projects/${projectId}/specs/${kind}/revisions/compare?from=${fromVersion}&to=${toVersion}`,
      { token },
    ).then((result) => {
      if (!cancel) {
        setReport(buildCompareReport(result.before ?? {}, result.after ?? {}));
        setMessage("");
      }
    }).catch((error: unknown) => {
      if (!cancel) {
        setReport(null);
        setMessage(error instanceof ApiError ? error.message : authErrorMessage(error));
      }
    });
    return () => {
      cancel = true;
    };
  }, [fromVersion, toVersion, projectId, token, kind]);

  if (loading) {
    return <p className="state-panel">이력을 불러오는 중입니다.</p>;
  }
  return (
    <div className="history-screen">
      <section>
        {heading ? <h2>{heading}</h2> : null}
        <p className="section-empty">저장된 이력은 조회만 할 수 있습니다.</p>
        {revisions.length === 0 ? <div className="empty-work"><h2>아직 변경 이력이 없습니다.</h2></div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>변경 일시</th>
                  <th>변경자</th>
                  <th>변경 작업</th>
                  <th>대상 {noun}</th>
                  <th>변경 사유</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.version}>
                    <td>{revision.version}</td>
                    <td>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(revision.createdAt))}</td>
                    <td>{revision.actor?.name || "—"}</td>
                    <td>{operations[revision.summary?.op ?? ""] || revision.summary?.op || "—"}</td>
                    <td>{revision.summary?.name || (revision.summary?.op === "REORDER_ITEMS" ? `${noun} 순서` : "—")}</td>
                    <td>{revision.changeReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="compare-panel">
        <h2>버전 비교</h2>
        {revisions.length < 2 ? <div className="empty-work"><h2>비교할 이전 Version이 없습니다.</h2><p>규격을 한 번 더 저장하면 두 Version을 비교할 수 있습니다.</p></div> : (
          <>
            <div className="field-grid">
              <label>변경 전
                <select value={fromVersion} onChange={(event) => setFromVersion(Number(event.target.value))}>
                  {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
                </select>
              </label>
              <label>변경 후
                <select value={toVersion} onChange={(event) => setToVersion(Number(event.target.value))}>
                  {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
                </select>
              </label>
            </div>
            {fromVersion === toVersion ? <p className="section-empty">서로 다른 Version을 선택하세요.</p> : null}
            {report ? <CompareView report={report} fromVersion={fromVersion} toVersion={toVersion} noun={noun} /> : null}
          </>
        )}
        {message ? <p className="banner danger">{message}</p> : null}
      </section>
    </div>
  );
}

function CompareView({ report, fromVersion, toVersion, noun }: { report: CompareReport; fromVersion: number; toVersion: number; noun: string }) {
  const counts = [
    report.added.length ? `추가 ${report.added.length}` : "",
    report.removed.length ? `삭제 ${report.removed.length}` : "",
    report.changed.length ? `수정 ${report.changed.length}` : "",
    report.orderChanged ? "순서 변경" : "",
    report.overview.length ? "문서 개요 변경" : "",
  ].filter(Boolean);
  return (
    <div>
      <p className="section-empty">{counts.length ? counts.join(" · ") : "선택한 두 Version의 차이는 없습니다."}</p>
      {report.overview.length > 0 ? <ChangeTable title="문서 개요" lines={report.overview} /> : null}
      {report.orderChanged ? (
        <div className="compare-pair">
          <section className="diff-before"><h3>변경 전 순서 · v{fromVersion}</h3><ol>{report.orderBefore.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol></section>
          <section className="diff-after"><h3>변경 후 순서 · v{toVersion}</h3><ol>{report.orderAfter.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol></section>
        </div>
      ) : null}
      <EndpointGroup title={`${noun} 추가`} items={report.added} tone="added" />
      <EndpointGroup title={`${noun} 삭제`} items={report.removed} tone="removed" />
      {report.changed.map((item) => (
        <article key={item.itemUid} className="diff-card">
          <h3>{item.title}</h3>
          <div className="inline-actions">{item.tags.map((tag) => <span key={tag} className="badge info">{tag}</span>)}</div>
          <ChangeTable title="변경 내용" lines={item.lines} />
          {item.examples.map((example) => (
            <div key={example.label} className="compare-pair">
              <section className="diff-before"><h3>{example.label} · 변경 전</h3><pre>{example.before || "없음"}</pre></section>
              <section className="diff-after"><h3>{example.label} · 변경 후</h3><pre>{example.after || "없음"}</pre></section>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function EndpointGroup({ title, items, tone }: { title: string; items: CompareReport["added"]; tone: "added" | "removed" }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section>
      <h3>{title}</h3>
      {items.map((item) => (
        <article key={item.itemUid} className={`diff-card is-${tone}`}>
          <h3>{item.title}</h3>
          <ChangeTable title="저장된 값" lines={item.lines} />
        </article>
      ))}
    </section>
  );
}

function ChangeTable({ title, lines }: { title: string; lines: CompareReport["overview"] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>{title}</th><th>필드</th><th>변경 전</th><th>변경 후</th></tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.area}-${line.field}-${index}`} className={`diff-row is-${line.kind}`}>
              <td><span className={`badge ${line.kind === "removed" ? "" : line.kind === "added" ? "success" : "info"}`}>{kindLabel(line.kind)}</span> {line.area}</td>
              <td><code>{line.field}</code></td>
              <td>{line.before}</td>
              <td>{line.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function kindLabel(kind: "added" | "removed" | "changed") {
  if (kind === "added") {
    return "추가";
  }
  if (kind === "removed") {
    return "삭제";
  }
  return "변경";
}
