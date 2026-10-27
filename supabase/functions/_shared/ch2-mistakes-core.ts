export type Ch2MistakeEvidenceKind = "interactive_first_attempt" | "final_submission_wrong";
export type Ch2MistakeStatus = "needs_review" | "reviewed" | "mastered";

export type Ch2MistakeEvidence = {
  source_kind: Ch2MistakeEvidenceKind;
  source_ref: string;
  attempt_no?: number | null;
  is_correct: boolean | null;
  submitted?: boolean;
};

export type Ch2MistakeListItem = {
  lecture_no: number;
  track_key: "class" | "home";
  skill_ref: string;
  status: Ch2MistakeStatus | "incomplete";
};

export type Ch2MistakeFilters = {
  lecture_no?: number | null;
  track_key?: "class" | "home" | null;
  skill_ref?: string | null;
  status?: Ch2MistakeStatus | "incomplete" | null;
};

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MISTAKE_REF = new RegExp(`^(?:attempt:${UUID_V4}|submission:${UUID_V4}:${UUID_V4})$`, "i");

export function validateCh2MistakeRef(value: unknown): string {
  const reference = String(value ?? "").trim().toLowerCase();
  if (!MISTAKE_REF.test(reference)) throw new Error("invalid_mistake_ref");
  return reference;
}

export function isVerifiedCh2MistakeEvidence(evidence: Ch2MistakeEvidence): boolean {
  if (evidence.is_correct !== false) return false;
  if (evidence.source_kind === "interactive_first_attempt") return evidence.attempt_no === 1;
  if (evidence.source_kind === "final_submission_wrong") return evidence.submitted === true;
  return false;
}

export function classifyCh2MistakeStatus(args: {
  reviewed_at?: string | Date | null;
  mastery_attempts?: { is_correct: boolean; attempted_at?: string | Date }[];
}): Ch2MistakeStatus {
  if ((args.mastery_attempts ?? []).some((attempt) => attempt.is_correct)) return "mastered";
  if (args.reviewed_at) return "reviewed";
  return "needs_review";
}

export function filterCh2MistakeItems<T extends Ch2MistakeListItem>(items: T[], filters: Ch2MistakeFilters): T[] {
  return items.filter((item) =>
    (!filters.lecture_no || item.lecture_no === filters.lecture_no) &&
    (!filters.track_key || item.track_key === filters.track_key) &&
    (!filters.skill_ref || item.skill_ref === filters.skill_ref) &&
    (!filters.status || item.status === filters.status)
  );
}

export function summarizeCh2Mistakes(items: Ch2MistakeListItem[]) {
  const mistakes = items.filter((item) => item.status !== "incomplete");
  return {
    total_mistakes: mistakes.length,
    needs_review: mistakes.filter((item) => item.status === "needs_review").length,
    reviewed: mistakes.filter((item) => item.status === "reviewed").length,
    mastered: mistakes.filter((item) => item.status === "mastered").length,
    incomplete: items.filter((item) => item.status === "incomplete").length,
  };
}
