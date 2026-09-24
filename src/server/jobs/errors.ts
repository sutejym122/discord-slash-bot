export class JobError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly code: string,
    message: string,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export const retryable = (
  code: string,
  message: string,
  httpStatus?: number,
  retryAfterMs?: number,
) => new JobError(true, code, message, httpStatus, retryAfterMs);

export const permanent = (code: string, message: string, httpStatus?: number) =>
  new JobError(false, code, message, httpStatus);
