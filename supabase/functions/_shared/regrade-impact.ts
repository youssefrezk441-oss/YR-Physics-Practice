export type RegradeImpactItem = {
  attemptRef: string;
  responseRef: string;
  studentUserId?: string | null;
  previousPoints: number;
  proposedPoints: number;
  maxPoints: number;
};

export type RegradeImpactSummary = {
  affectedResponses: number;
  affectedAttempts: number;
  affectedStudents: number;
  increases: number;
  decreases: number;
  unchanged: number;
  totalScoreDelta: number;
};

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

export function summarizeRegradeImpact(items: readonly RegradeImpactItem[]): RegradeImpactSummary {
  const responses = new Set<string>();
  const attempts = new Set<string>();
  const students = new Set<string>();
  let affectedResponses = 0;
  let increases = 0;
  let decreases = 0;
  let unchanged = 0;
  let totalScoreDelta = 0;

  for (const item of items) {
    if (!item || !item.attemptRef?.trim() || !item.responseRef?.trim()) {
      throw new Error('Every impact item needs stable attempt and response references.');
    }
    if (responses.has(item.responseRef)) throw new Error(`Duplicate response in impact preview: ${item.responseRef}`);
    responses.add(item.responseRef);
    if (![item.previousPoints, item.proposedPoints, item.maxPoints].every(finite) ||
        item.maxPoints < 0 || item.previousPoints < 0 || item.proposedPoints < 0 ||
        item.previousPoints > item.maxPoints || item.proposedPoints > item.maxPoints) {
      throw new Error(`Invalid score bounds for response: ${item.responseRef}`);
    }

    const delta = Number((item.proposedPoints - item.previousPoints).toFixed(4));
    if (delta === 0) {
      unchanged += 1;
      continue;
    }
    affectedResponses += 1;
    attempts.add(item.attemptRef);
    if (item.studentUserId) students.add(item.studentUserId);
    if (delta > 0) increases += 1;
    else decreases += 1;
    totalScoreDelta = Number((totalScoreDelta + delta).toFixed(4));
  }

  return {
    affectedResponses,
    affectedAttempts: attempts.size,
    affectedStudents: students.size,
    increases,
    decreases,
    unchanged,
    totalScoreDelta,
  };
}

export function assertRegradeApproval(
  preview: { id: string; createdBy: string; expiresAt: string; summary: RegradeImpactSummary },
  approval: {
    previewId: string;
    approvedBy: string;
    expectedAffectedAttempts: number;
    expectedTotalScoreDelta: number;
  },
  now = new Date(),
): void {
  if (!preview.id || approval.previewId !== preview.id) throw new Error('Approval does not match the impact preview.');
  if (!approval.approvedBy || approval.approvedBy === preview.createdBy) throw new Error('A second administrator must approve the regrade.');
  if (!Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= now.getTime()) {
    throw new Error('The impact preview has expired.');
  }
  if (approval.expectedAffectedAttempts !== preview.summary.affectedAttempts ||
      Math.abs(approval.expectedTotalScoreDelta - preview.summary.totalScoreDelta) > 0.0001) {
    throw new Error('The approved impact no longer matches the preview.');
  }
}
