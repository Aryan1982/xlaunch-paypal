import type express from "express";

export class HttpError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

type RequestHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<unknown> | unknown;

/** Express 5 forwards rejected promises, but this keeps the intent explicit. */
export const handle =
  (fn: RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };

export const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
