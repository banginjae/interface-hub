import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { apiRequest } from "../api";
import { useAuth } from "../auth";
import type { ProjectDetail } from "../projectTypes";

export function ProjectNav({
  projectId,
  allow,
}: {
  projectId: string;
  allow: (event: { preventDefault: () => void }) => void;
}) {
  const auth = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!auth.token) {
      return;
    }
    let cancel = false;
    apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token: auth.token })
      .then((detail) => {
        if (!cancel) {
          setProject(detail);
        }
      })
      .catch(() => {
        if (!cancel) {
          setProject(null);
        }
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!auth.token || !project) {
      return;
    }
    let cancel = false;
    const kinds = ["API", "MQTT", "WEBSOCKET", "DEVICE_PROTOCOL"] as const;
    for (const kind of kinds) {
      const summary = project.specSummaries.find((item) => item.kind === kind);
      if (!summary?.exists) {
        setCounts((current) => ({ ...current, [kind]: null }));
        continue;
      }
      apiRequest<{ items?: unknown[] }>(`/api/projects/${projectId}/specs/${kind}`, { token: auth.token })
        .then((document) => {
          if (!cancel) {
            setCounts((current) => ({ ...current, [kind]: document.items?.length ?? 0 }));
          }
        })
        .catch(() => {
          if (!cancel) {
            setCounts((current) => ({ ...current, [kind]: null }));
          }
        });
    }
    return () => {
      cancel = true;
    };
  }, [auth.token, project, projectId]);

  const base = `/projects/${projectId}`;
  const location = useLocation();
  const panel = new URLSearchParams(location.search).get("panel");
  return (
    <div className="side-scroll">
      <NavLink to="/projects" className="nav-item" onClick={allow}>← 프로젝트</NavLink>
      <p className="side-label">프로젝트</p>
      <NavLink to={base} end className={() => `nav-item${location.pathname === base && !panel && !location.hash ? " active" : ""}`} onClick={allow}>개요</NavLink>
      <p className="side-label">규격</p>
      <NavLink to={`${base}/specs/api`} className="nav-item" onClick={allow}>REST API <small>{countText(counts.API)}</small></NavLink>
      <NavLink to={`${base}/specs/mqtt`} className="nav-item" onClick={allow}>MQTT <small>{countText(counts.MQTT)}</small></NavLink>
      <NavLink to={`${base}/specs/websocket`} className="nav-item" onClick={allow}>WebSocket <small>{countText(counts.WEBSOCKET)}</small></NavLink>
      <NavLink to={`${base}/specs/device`} className="nav-item" onClick={allow}>장비 프로토콜 <small>{countText(counts.DEVICE_PROTOCOL)}</small></NavLink>
      <p className="side-label">자료</p>
      <NavLink to={`${base}/error-codes`} className="nav-item" onClick={allow}>오류 코드 <small>{project?.errorCodeCount ?? ""}</small></NavLink>
      <NavLink to={`${base}/docs`} className="nav-item" onClick={allow}>일반 문서 <small>{project?.generalDocumentCount ?? ""}</small></NavLink>
      <p className="side-label">관리</p>
      <NavLink to={`${base}#changes`} className={() => `nav-item${location.hash === "#changes" ? " active" : ""}`} onClick={allow}>최근 변경</NavLink>
      <NavLink to={`${base}?panel=members`} className={() => `nav-item${panel === "members" ? " active" : ""}`} onClick={allow}>멤버</NavLink>
      <NavLink to={`${base}?panel=settings`} className={() => `nav-item${panel === "settings" ? " active" : ""}`} onClick={allow}>프로젝트 설정</NavLink>
    </div>
  );
}

function countText(count: number | null | undefined) {
  return count === null || count === undefined ? "" : String(count);
}
