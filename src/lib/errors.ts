import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Consistent, client-safe error envelope. Every error the API returns has the
 * shape `{ error: { code, message, requestId, details? } }`. Stack traces and
 * internal messages never reach the client.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * A thrown error the API is willing to describe to the client. Anything that is
 * NOT an ApiError is treated as an unexpected 500 with a generic message.
 */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found"): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message = "Conflict"): ApiError {
    return new ApiError(409, "CONFLICT", message);
  }

  static payloadTooLarge(message = "Payload too large"): ApiError {
    return new ApiError(413, "PAYLOAD_TOO_LARGE", message);
  }

  static unsupportedMediaType(message = "Unsupported media type"): ApiError {
    return new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", message);
  }

  static internal(message = "Internal server error"): ApiError {
    return new ApiError(500, "INTERNAL", message);
  }

  static serviceUnavailable(message = "Service unavailable"): ApiError {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message);
  }
}

export function toErrorBody(err: ApiError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details === undefined ? {} : { details: err.details }),
    },
  };
}
