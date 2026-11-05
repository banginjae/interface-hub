export type AccountUser = {
  id: number;
  employeeNo: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  passwordMustChange?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoginResult = {
  accessToken: string;
  expiresIn: number;
  user: {
    id: number;
    employeeNo: string;
    name: string;
    role: string;
  };
};

export class ApiError extends Error {
  status: number;
  code: string;
  currentVersion?: number;

  constructor(status: number, message: string, code = "", currentVersion?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentVersion = currentVersion;
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "API 서버에 연결하지 못했습니다.");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "요청을 처리하지 못했습니다.");
    }
  }
  if (!response.ok) {
    const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
    const message = typeof record.message === "string" ? record.message : "요청을 처리하지 못했습니다.";
    const code = typeof record.code === "string" ? record.code : "";
    const currentVersion = typeof record.currentVersion === "number" ? record.currentVersion : undefined;
    throw new ApiError(response.status, message, code, currentVersion);
  }
  return data as T;
}
