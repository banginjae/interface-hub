export type ProjectSummary = {
  id: number;
  title: string;
  status: string;
  createdBy: { id: number; name: string };
  createdAt: string;
  myPermission: string;
  description?: string;
};

export type ProjectDetail = ProjectSummary & {
  description: string;
  version: number;
  specSummaries: { kind: string; exists: boolean; version?: number; updatedAt?: string; updatedByName?: string }[];
  generalDocumentCount: number;
  errorCodeCount: number;
};

export type ProjectMember = {
  userId: number;
  employeeNo: string;
  name: string;
  permission: string;
  creator: boolean;
};

export function permissionLabel(permission: string) {
  if (permission === "WRITE") {
    return "편집";
  }
  if (permission === "READ") {
    return "조회";
  }
  return "없음";
}
