import type { ApiErrorBody, ErrorCode } from "@lkti/shared";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: { retryable?: boolean; retryAfter?: number; upstreamRequestId?: string } = {},
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.options.retryable ?? false,
        ...(this.options.retryAfter !== undefined ? { retryAfter: this.options.retryAfter } : {}),
        ...(this.options.upstreamRequestId ? { upstreamRequestId: this.options.upstreamRequestId } : {}),
      },
    };
  }
}

export const badRequest = (message: string) => new HttpError(400, "BAD_REQUEST", message);
