import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { apiRequest } from "../api";
import { useAuth } from "../auth";
import type { ProjectDetail } from "../projectTypes";

export const specChangedEvent = "interface-hub:spec-changed";

export function notifySpecChanged() {
  window.dispatchEvent(new Event(specChangedEvent));
}

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
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const bump = () => setRefresh((value) => value + 1);
    window.addEventListener(specChangedEvent, bump);
    return () => window.removeEventListener(specChangedEvent, bump);
  }, []);

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
  }, [auth.token, projectId, refresh]);

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
  const onHome = location.pathname === base;
  const canManage = Boolean(project && auth.user && (auth.user.role === "MASTER" || project.createdBy?.id === auth.user.id));
  return (
    <div className="side-scroll">
      <NavLink to="/projects" end className="nav-item nav-back" onClick={allow}>← 프로젝트 목록</NavLink>
      <p className="side-project" title={project?.title ?? ""}>{project?.title ?? "프로젝트"}</p>
      <NavLink to={base} end state={{ scrollTop: true }} className={() => `nav-item${onHome && !panel && !location.hash ? " active" : ""}`} onClick={allow}>홈</NavLink>
      <p className="side-label">규격</p>
      <NavLink to={`${base}/specs/api`} className="nav-item" onClick={allow}>REST API <small>{countText(counts.API)}</small></NavLink>
      <NavLink to={`${base}/specs/mqtt`} className="nav-item" onClick={allow}>MQTT <small>{countText(counts.MQTT)}</small></NavLink>
      <NavLink to={`${base}/specs/websocket`} className="nav-item" onClick={allow}>WebSocket <small>{countText(counts.WEBSOCKET)}</small></NavLink>
      <NavLink to={`${base}/specs/device`} className="nav-item" onClick={allow}>장비 프로토콜 <small>{countText(counts.DEVICE_PROTOCOL)}</small></NavLink>
      <p className="side-label">자료</p>
      <NavLink to={`${base}/error-codes`} className="nav-item" onClick={allow}>오류 코드 <small>{project?.errorCodeCount ?? ""}</small></NavLink>
      <NavLink to={`${base}/docs`} className="nav-item" onClick={allow}>일반 문서 <small>{project?.generalDocumentCount ?? ""}</small></NavLink>
      <p className="side-label">관리</p>
      <NavLink to={`${base}#changes`} className={() => `nav-item${onHome && location.hash === "#changes" ? " active" : ""}`} onClick={allow}>최근 변경</NavLink>
      <NavLink to={`${base}?panel=members`} className={() => `nav-item${onHome && panel === "members" ? " active" : ""}`} onClick={allow}>멤버</NavLink>
      {canManage ? <NavLink to={`${base}?panel=settings`} className={() => `nav-item${onHome && panel === "settings" ? " active" : ""}`} onClick={allow}>프로젝트 설정</NavLink> : null}
    </div>
  );
}

function countText(count: number | null | undefined) {
  return count === null || count === undefined ? "" : String(count);
}
