import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
