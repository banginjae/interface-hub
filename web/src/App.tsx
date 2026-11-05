import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { appConfig } from "./appConfig";
import { AuthProvider } from "./auth";
import { AccountPage } from "./pages/AccountPage";
import { HealthPage } from "./pages/HealthPage";
import { LoginPage } from "./pages/LoginPage";
import { MissingPage } from "./pages/MissingPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { MqttPage } from "./pages/MqttPage";
import { DevicePage } from "./pages/DevicePage";
import { WsPage } from "./pages/WsPage";
import { DocsPage } from "./pages/DocsPage";
import { ErrorCodesPage } from "./pages/ErrorCodesPage";
import { SpecPage } from "./pages/SpecPage";
import { ProjectNewPage, ProjectsPage } from "./pages/ProjectsPage";
import { UsersPage } from "./pages/UsersPage";
import { Shell } from "./Shell";

export default function App() {
  useEffect(() => {
    document.title = appConfig.serviceName;
  }, []);
  return (
    <AuthProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<HealthPage />} />
          <Route path="/status" element={<HealthPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<ProjectNewPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/specs/api" element={<SpecPage />} />
          <Route path="/projects/:id/specs/mqtt" element={<MqttPage />} />
          <Route path="/projects/:id/specs/websocket" element={<WsPage />} />
          <Route path="/projects/:id/specs/device" element={<DevicePage />} />
          <Route path="/projects/:id/docs" element={<DocsPage />} />
          <Route path="/projects/:id/error-codes" element={<ErrorCodesPage />} />
          <Route path="/master/users" element={<UsersPage />} />
          <Route path="*" element={<MissingPage />} />
        </Routes>
      </Shell>
    </AuthProvider>
  );
}
