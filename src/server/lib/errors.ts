// HTTP error type shared by every route (ROADMAP phase 17 — unified validation). Kept in its own module so the zod
// validation layer (lib/validate.ts) and lib/util.ts can both build errors without a circular import.
// `details` carries machine-readable extras (e.g. per-field validation messages) that app.onError adds to the JSON body.

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, unknown>) {
    super(message)
  }
}

export const bad = (msg: string, code?: string) => new HttpError(400, msg, code)
export const notFound = (msg = 'یافت نشد') => new HttpError(404, msg)
export const forbidden = (msg = 'دسترسی ندارید') => new HttpError(403, msg)
