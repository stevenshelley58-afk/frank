/**
 * Translate a raw googleapis/gaxios failure into a typed GoogleConnectorError
 * so callers never see the underlying HTTP library's shape.
 */
import { GoogleConnectorError } from "./types.js";
import type { GoogleConnectorError as _GCE } from "./types.js";

type Surface = _GCE["surface"];

interface GaxiosLikeError {
  code?: number | string;
  response?: { status?: number; data?: { error?: { message?: string; status?: string } } };
  errors?: Array<{ reason?: string }>;
  message?: string;
}

export function toConnectorError(error: unknown, surface: Surface, action: string): GoogleConnectorError {
  const err = error as GaxiosLikeError;
  const status = typeof err?.code === "number" ? err.code : err?.response?.status;
  const detail =
    err?.response?.data?.error?.message ??
    err?.message ??
    "unknown error";

  let code: GoogleConnectorError["code"];
  switch (status) {
    case 401:
      code = "auth";
      break;
    case 403:
      code = "permission";
      break;
    case 404:
      code = "not_found";
      break;
    case 429:
      code = "rate_limited";
      break;
    case 400:
      code = "invalid_request";
      break;
    default:
      code = "upstream";
  }

  // 403 also covers rate limits reported as USER_RATE_LIMIT_EXCEEDED.
  if (status === 403 && err?.errors?.some((e) => e.reason?.toLowerCase().includes("ratelimit"))) {
    code = "rate_limited";
  }

  return new GoogleConnectorError({
    code,
    surface,
    ...(status !== undefined ? { status } : {}),
    message: `Google ${surface} ${action} failed (${status ?? "no-status"}): ${detail}`,
    cause: error,
  });
}
