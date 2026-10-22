export const MAX_WORKSHOP_REQUEST_BYTES = 16 * 1024;

export class WorkshopRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WorkshopRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function readWorkshopJson(
  req: Request,
  maxBytes = MAX_WORKSHOP_REQUEST_BYTES,
): Promise<Record<string, unknown>> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > maxBytes) {
      throw new WorkshopRequestError(413, "request_too_large", "الطلب أكبر من الحد المسموح.");
    }
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new WorkshopRequestError(413, "request_too_large", "الطلب أكبر من الحد المسموح.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WorkshopRequestError(400, "invalid_json", "صيغة الطلب غير صحيحة.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkshopRequestError(400, "invalid_json", "صيغة الطلب غير صحيحة.");
  }
  return parsed as Record<string, unknown>;
}

export function expectedAttempts(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new WorkshopRequestError(400, "invalid_progress_version", "نسخة التقدم المرسلة غير صحيحة.");
  }
  return value;
}

export function isStaleProgress(expected: number | null, actual: number): boolean {
  return expected !== null && expected !== actual;
}

export function staleProgressResult(progress: unknown, attemptsCount: number) {
  return {
    ok: true,
    stale: true,
    correct: false,
    attempts_count: attemptsCount,
    progress,
    message: "تغير تقدم هذا السؤال في تبويب آخر. تم تحميل أحدث حالة دون تسجيل محاولة جديدة.",
  };
}
