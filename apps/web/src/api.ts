import { systemStatusSchema, type SystemStatus } from "@frank/shared";

const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await fetch(`${apiBase}/v1/system/status`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body.message === "string"
        ? body.message
        : `Frank API returned HTTP ${response.status}`;
    throw new Error(message);
  }

  const data = await response.json();
  return systemStatusSchema.parse(data);
}
