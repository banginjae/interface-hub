import { Link } from "react-router-dom";
import { usePageChrome } from "../Shell";

export function MissingPage() {
  usePageChrome("페이지가 없습니다", []);
  return (
    <main className="page">
      <section className="state-panel">
        <h1>페이지가 없습니다</h1>
        <p>요청한 화면은 아직 제공되지 않습니다.</p>
        <Link to="/projects">프로젝트로 이동</Link>
      </section>
    </main>
  );
}
