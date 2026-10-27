export type WorkshopInputType = "mcq" | "numeric" | "text" | "symbolic";

export type WorkshopKeySpec = {
  option?: string;
  value?: number;
  tolerance_abs?: number;
  accepted_forms?: string[];
};

export type WorkshopProgressState = {
  revision: number;
  attempts_count: number;
  tried_answers: string[];
  first_attempt_correct: boolean | null;
  independently_mastered: boolean;
  assisted: boolean;
  revealed: boolean;
};

export type WorkshopAttemptPolicy = {
  max_unique_attempts: number;
  reveal_after_attempts: number;
  auto_reveal_mcq: boolean;
};

export class WorkshopContractError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WorkshopContractError";
    this.status = status;
    this.code = code;
  }
}

const digitMap: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٫": ".", "٬": ",", "−": "-", "–": "-", "—": "-",
};

export function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/[٠-٩۰-۹٫٬−–—]/g, (character) => digitMap[character] ?? character);
}

export function normalizeLetter(value: unknown): string {
  const cleaned = normalizeDigits(value).trim().replace(/[\s.،,:;\-]/g, "");
  const aliases: Record<string, string> = {
    "ا": "أ", "أ": "أ", "إ": "أ", "آ": "أ", "a": "أ", "A": "أ", "1": "أ",
    "ب": "ب", "b": "ب", "B": "ب", "2": "ب",
    "ج": "ج", "g": "ج", "G": "ج", "c": "ج", "C": "ج", "3": "ج",
    "د": "د", "d": "د", "D": "د", "4": "د",
  };
  return aliases[cleaned] ?? aliases[cleaned[0]] ?? cleaned;
}

export function normalizeText(value: unknown): string {
  return normalizeDigits(value)
    .normalize("NFKC")
    .replace(/ـ/g, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[،,;؛:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStrictNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let text = normalizeDigits(value)
    .replace(/Ω|Ω|أوم|اوم/gi, "")
    .replace(/\b(ohm|ohms|volt|volts|amp|amps|v|a)\b/gi, "")
    .trim()
    .replace(/(?<=\d),(?=\d)/g, ".")
    .replace(/\s+/g, "");
  if (/^[+-]?\d+(?:\.\d+)?\/[+-]?\d+(?:\.\d+)?$/.test(text)) {
    const [numerator, denominator] = text.split("/").map(Number);
    return denominator === 0 ? null : numerator / denominator;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSymbolic(value: unknown): string {
  return normalizeDigits(value)
    .normalize("NFKC")
    .replace(/_/g, "")
    .replace(/[×·*]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (character) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(character)))
    .replace(/sqrt\(3\)/g, "√3");
}

export function normalizeWorkshopAnswer(inputType: WorkshopInputType, value: unknown): string | null {
  if (inputType === "mcq") return normalizeLetter(value);
  if (inputType === "numeric") {
    const parsed = parseStrictNumber(value);
    return parsed === null ? null : String(parsed);
  }
  if (inputType === "symbolic") return normalizeSymbolic(value);
  return normalizeText(value);
}

export function gradeWorkshopAnswer(
  inputType: WorkshopInputType,
  key: WorkshopKeySpec,
  value: unknown,
): { correct: boolean; normalized: string } {
  const normalized = normalizeWorkshopAnswer(inputType, value);
  if (!normalized) throw new WorkshopContractError(400, "invalid_answer", "اكتب إجابة صالحة.");

  if (inputType === "mcq") {
    const expected = normalizeLetter(key.option);
    if (!expected || !["أ", "ب", "ج", "د"].includes(normalized)) {
      throw new WorkshopContractError(400, "invalid_answer", "اختر إجابة من البدائل المتاحة.");
    }
    return { correct: normalized === expected, normalized };
  }

  if (inputType === "numeric") {
    const number = parseStrictNumber(value);
    if (number === null) throw new WorkshopContractError(400, "invalid_answer", "اكتب قيمة رقمية صحيحة.");
    const tolerance = Math.max(0, Number(key.tolerance_abs ?? 0));
    if (Number.isFinite(Number(key.value))) {
      return { correct: Math.abs(number - Number(key.value)) <= tolerance + 1e-12, normalized };
    }
    const accepted = (key.accepted_forms ?? []).map(parseStrictNumber).filter((item): item is number => item !== null);
    return { correct: accepted.some((item) => Math.abs(number - item) <= tolerance + 1e-12), normalized };
  }

  const normalize = inputType === "symbolic" ? normalizeSymbolic : normalizeText;
  const accepted = (key.accepted_forms ?? []).map(normalize).filter(Boolean);
  return { correct: accepted.includes(normalized), normalized };
}

export function validateRequestId(value: unknown): string {
  const requestId = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new WorkshopContractError(400, "invalid_request_id", "معرف الطلب غير صالح. حدّث الصفحة وحاول مجددًا.");
  }
  return requestId;
}

export function validateExpectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new WorkshopContractError(400, "invalid_progress_version", "نسخة التقدم المرسلة غير صحيحة.");
  }
  return value;
}

export function decideInteractiveAttempt(args: {
  progress: WorkshopProgressState;
  policy: WorkshopAttemptPolicy;
  expectedRevision: number;
  normalized: string;
  correct: boolean;
  inputType: WorkshopInputType;
  optionCount?: number;
}) {
  const { progress, policy, expectedRevision, normalized, correct, inputType } = args;
  if (progress.revision !== expectedRevision) return { kind: "stale" as const, progress };
  if (progress.independently_mastered) return { kind: "already_mastered" as const, progress };
  if (progress.revealed || progress.assisted) return { kind: "already_assisted" as const, progress };
  if (progress.tried_answers.includes(normalized)) return { kind: "duplicate" as const, progress };
  if (progress.attempts_count >= policy.max_unique_attempts) return { kind: "locked" as const, progress };

  const nextAttempts = progress.attempts_count + 1;
  const nextTried = [...progress.tried_answers, normalized];
  const exhaustedMcq = inputType === "mcq" && policy.auto_reveal_mcq &&
    !correct && (nextAttempts >= policy.max_unique_attempts ||
      (Number(args.optionCount ?? 4) > 1 && nextTried.length >= Number(args.optionCount ?? 4) - 1));
  const assisted = exhaustedMcq;
  const next: WorkshopProgressState = {
    revision: progress.revision + 1,
    attempts_count: nextAttempts,
    tried_answers: nextTried,
    first_attempt_correct: progress.first_attempt_correct ?? (nextAttempts === 1 ? correct : false),
    independently_mastered: correct,
    assisted,
    revealed: assisted,
  };
  return {
    kind: correct ? "mastered" as const : assisted ? "assisted" as const : "incorrect" as const,
    progress: next,
    can_reveal: !correct && !assisted && nextAttempts >= policy.reveal_after_attempts,
  };
}

export function classifyWorkshopOutcome(progress: WorkshopProgressState):
  "not_started" | "first_try" | "later_independent" | "assisted" | "in_progress" {
  if (progress.attempts_count === 0 && !progress.revealed) return "not_started";
  if (progress.revealed || progress.assisted) return "assisted";
  if (progress.independently_mastered && progress.first_attempt_correct) return "first_try";
  if (progress.independently_mastered) return "later_independent";
  return "in_progress";
}

export function summarizeWorkshopProgress(rows: WorkshopProgressState[]) {
  const attempted = rows.filter((row) => row.attempts_count > 0 || row.revealed);
  const count = attempted.length;
  const firstTry = attempted.filter((row) => row.first_attempt_correct === true).length;
  const independent = attempted.filter((row) => row.independently_mastered).length;
  const assisted = attempted.filter((row) => row.assisted || row.revealed).length;
  const laterIndependent = attempted.filter((row) => row.independently_mastered && row.first_attempt_correct === false).length;
  const rate = (value: number) => count ? Math.round(value * 1000 / count) / 10 : 0;
  return {
    attempted: count,
    firstTry,
    laterIndependent,
    independent,
    assisted,
    firstAttemptRate: rate(firstTry),
    independentMasteryRate: rate(independent),
    assistedRate: rate(assisted),
  };
}

export type WorkshopRegradeDecision = {
  id: string;
  user_id?: string;
  answer_snapshot: { raw?: any } | null;
  is_correct: boolean;
  awarded_points: number | string;
  max_points: number | string;
};

export function previewWorkshopRegrade<T extends WorkshopRegradeDecision>(
  inputType: WorkshopInputType,
  key: WorkshopKeySpec,
  decisions: T[],
) {
  const changes = decisions.flatMap((decision) => {
    const graded = gradeWorkshopAnswer(inputType, key, decision.answer_snapshot?.raw);
    const maxPoints = Number(decision.max_points);
    const previousPoints = Number(decision.awarded_points);
    const proposedPoints = graded.correct ? maxPoints : 0;
    return graded.correct === decision.is_correct && proposedPoints === previousPoints ? [] : [{
      decision,
      proposedCorrect: graded.correct,
      proposedPoints,
      maxPoints,
    }];
  });
  const affectedStudents = new Set(changes.map((item) => item.decision.user_id).filter(Boolean)).size;
  const summary = {
    affected_responses: changes.length,
    affected_students: affectedStudents,
    increases: changes.filter((item) => item.proposedPoints > Number(item.decision.awarded_points)).length,
    decreases: changes.filter((item) => item.proposedPoints < Number(item.decision.awarded_points)).length,
    total_score_delta: changes.reduce((sum, item) => sum + item.proposedPoints - Number(item.decision.awarded_points), 0),
  };
  return { changes, summary };
}

export function deriveInteractiveProgressAfterRegrade(
  attempts: { is_correct: boolean; server_received_at: string | Date }[],
  revealedAt?: string | Date | null,
) {
  const revealTime = revealedAt ? new Date(revealedAt).getTime() : null;
  const independentlyMastered = attempts.some((attempt) => attempt.is_correct &&
    (revealTime === null || new Date(attempt.server_received_at).getTime() < revealTime));
  const assisted = revealTime !== null && !independentlyMastered;
  return {
    first_attempt_correct: attempts.length ? Boolean(attempts[0].is_correct) : null,
    independently_mastered: independentlyMastered,
    assisted,
    revealed: assisted,
  };
}
