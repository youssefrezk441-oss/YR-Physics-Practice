import { gradeWorkshopAnswer, type WorkshopKeySpec } from "./unified-workshop-core.ts";

export type HomeworkAnswerState = "answered" | "unanswered";
export type HomeworkResponseKind = "auto_mcq" | "essay_self_review";
export type HomeworkSelfAssessment = "correct" | "partial" | "incorrect" | "unanswered";

export class PaperHomeworkError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PaperHomeworkError";
    this.status = status;
    this.code = code;
  }
}

export function validateHomeworkAnswer(args: {
  responseKind: HomeworkResponseKind;
  state: unknown;
  answer: unknown;
}) {
  if (args.state !== "answered" && args.state !== "unanswered") {
    throw new PaperHomeworkError(400, "invalid_answer_state", "اختر إجابة أو حدّد «لم أحل».");
  }
  if (args.state === "unanswered") return { state: "unanswered" as const, answer: null };
  if (!args.answer || typeof args.answer !== "object" || Array.isArray(args.answer)) {
    throw new PaperHomeworkError(400, "invalid_answer", "الإجابة غير صالحة.");
  }
  const answer = args.answer as Record<string, unknown>;
  if (args.responseKind === "auto_mcq") {
    const value = String(answer.raw ?? "").trim();
    if (!["أ", "ب", "ج", "د"].includes(value)) throw new PaperHomeworkError(400, "invalid_answer", "اختر أ أو ب أو ج أو د.");
    return { state: "answered" as const, answer: { raw: value } };
  }
  const text = String(answer.text ?? "").normalize("NFKC").trim().slice(0, 4000);
  const imageIds = Array.isArray(answer.image_ids)
    ? [...new Set(answer.image_ids.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 3)
    : [];
  if (!text && imageIds.length === 0) throw new PaperHomeworkError(400, "empty_essay", "اكتب إجابتك أو أرفق صورة لها.");
  return { state: "answered" as const, answer: { text, image_ids: imageIds } };
}

export function gradeHomeworkPart(args: {
  responseKind: HomeworkResponseKind;
  answerState: HomeworkAnswerState;
  answer: Record<string, unknown> | null;
  answerSpec: WorkshopKeySpec;
  maxPoints: number;
}) {
  if (args.answerState === "unanswered") {
    return { normalized: null, isCorrect: null, awardedPoints: 0, countsAsMistake: false };
  }
  if (args.responseKind === "essay_self_review") {
    return { normalized: null, isCorrect: null, awardedPoints: 0, countsAsMistake: false };
  }
  const graded = gradeWorkshopAnswer("mcq", args.answerSpec, args.answer?.raw);
  return {
    normalized: graded.normalized,
    isCorrect: graded.correct,
    awardedPoints: graded.correct ? args.maxPoints : 0,
    countsAsMistake: !graded.correct,
  };
}

export function validateSelfAssessment(value: unknown, answerState: HomeworkAnswerState): HomeworkSelfAssessment {
  const assessment = String(value ?? "") as HomeworkSelfAssessment;
  const allowed = new Set<HomeworkSelfAssessment>(["correct", "partial", "incorrect", "unanswered"]);
  if (!allowed.has(assessment)) throw new PaperHomeworkError(400, "invalid_assessment", "اختر تقييمًا صحيحًا لإجابتك.");
  if (answerState === "unanswered" && assessment !== "unanswered") {
    throw new PaperHomeworkError(409, "unanswered_assessment", "الإجابة غير المحلولة تبقى مصنفة «لم أحل».");
  }
  if (answerState === "answered" && assessment === "unanswered") {
    throw new PaperHomeworkError(409, "answered_assessment", "لا يمكن تصنيف إجابة مسجلة على أنها غير محلولة.");
  }
  return assessment;
}

export function summarizeHomework(parts: Array<{ responseKind: HomeworkResponseKind; answerState: HomeworkAnswerState; isCorrect: boolean | null; awardedPoints: number; maxPoints: number }>) {
  const mcq = parts.filter((part) => part.responseKind === "auto_mcq");
  return {
    answeredParts: parts.filter((part) => part.answerState === "answered").length,
    unansweredParts: parts.filter((part) => part.answerState === "unanswered").length,
    mcqScore: mcq.reduce((sum, part) => sum + part.awardedPoints, 0),
    mcqMaxScore: mcq.reduce((sum, part) => sum + part.maxPoints, 0),
    mcqWrong: mcq.filter((part) => part.answerState === "answered" && part.isCorrect === false).length,
    mcqUnanswered: mcq.filter((part) => part.answerState === "unanswered").length,
  };
}
