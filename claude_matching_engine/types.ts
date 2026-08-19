/**
 * Matching engine types.
 *
 * The exported contract types below mirror `docs/08_MATCHING_ENGINE_CONTRACT.md`
 * exactly. Do not change their shape without updating that document.
 *
 * `MatchingConfig` is NOT part of the contract. It is passed as an optional
 * second argument to `runMatching` so that tuning knobs can evolve without
 * touching `MatchingInput`.
 */

/* -------------------------------------------------------------------------- */
/* Contract: input                                                            */
/* -------------------------------------------------------------------------- */

export interface GroupSizePolicy {
  mode: "fixed" | "flexible";
  fixedSize?: number;
  minSize?: number;
  maxSize?: number;
}

export type ParticipantStatus = "JOINED" | "ACTIVE" | "LATE" | "MATCHABLE";

export interface MatchingParticipant {
  participantId: string;
  profileId: string;
  fullName: string;
  department: string;
  course: string;
  joinedAt: string;
  status: ParticipantStatus;
}

export interface MatchingQuestion {
  questionId: string;
  position: number;
  weight: number;
}

export interface MatchingOption {
  optionId: string;
  questionId: string;
  optionKey: string;
  matchingValue?: unknown;
}

export interface MatchingResponse {
  participantId: string;
  questionId: string;
  optionId: string | null;
  status: "ANSWERED" | "MISSED";
  updatedAt: string | null;
}

export interface MatchingInput {
  eventId: string;
  seed: string;
  groupSizePolicy: GroupSizePolicy;
  participants: MatchingParticipant[];
  questions: MatchingQuestion[];
  responses: MatchingResponse[];
  options: MatchingOption[];
}

/* -------------------------------------------------------------------------- */
/* Contract: output                                                           */
/* -------------------------------------------------------------------------- */

export interface MatchingGroup {
  temporaryId: string;
  code: string;
  name: string;
  icebreakerPrompt: string;
  memberParticipantIds: string[];
  score?: number;
  explanation?: string;
}

export type UnmatchedReason =
  | "too_many_missing_answers"
  | "late_join"
  | "overflow"
  | "removed"
  | "algorithm_error";

export interface MatchingUnmatched {
  participantId: string;
  reason: UnmatchedReason;
}

export interface MatchingAudit {
  eventId: string;
  seed: string;
  participantCount: number;
  matchableCount: number;
  matchedCount: number;
  unmatchedCount: number;
  groupCount: number;
  durationMs: number;
  policy: Record<string, unknown>;
  warnings: string[];
}

export interface MatchingOutput {
  success: boolean;
  groups: MatchingGroup[];
  unmatched: MatchingUnmatched[];
  audit: MatchingAudit;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Non-contract: tuning                                                       */
/* -------------------------------------------------------------------------- */

export interface MatchingConfig {
  /** Participants with more missed answers than this are excluded. */
  maxMissedAnswers: number;
  /** When true, LATE participants are excluded with reason `late_join`. */
  excludeLateJoiners: boolean;
  /**
   * Flexible mode only. When true, leftover participants that cannot form a
   * whole group are absorbed into existing groups (max one extra per group,
   * so a group can reach `maxSize + 1`) instead of being reported as overflow.
   *
   * DELIBERATE DEVIATION from the literal spec text. Leaving a real student
   * with no group at a live induction event is a worse outcome than a group of
   * six. Set to false to restore strict `maxSize` behaviour.
   */
  allowOversizeGroups: boolean;
  /** Used when policy.mode === "flexible" and minSize/maxSize are absent. */
  defaultMinSize: number;
  defaultMaxSize: number;
  /** Tie-breaker nudges. Kept far below the answer-similarity signal. */
  differentDepartmentBonus: number;
  differentCourseBonus: number;
  /** Hard cap applied to a raw pair score before normalisation. */
  maxPairScore: number;
  /** "auto" scales with participant count. */
  localSearchIterations: number | "auto";
  /** Greedy fill only scans this many unassigned candidates per slot. */
  candidateWindow: number;
  /** Above this participant count, pair scores are computed lazily. */
  precomputePairLimit: number;
  /** Attach a human-readable `explanation` to each group. */
  includeExplanations: boolean;
}

export type MatchingConfigOverrides = Partial<MatchingConfig>;

/* -------------------------------------------------------------------------- */
/* Internal                                                                   */
/* -------------------------------------------------------------------------- */

/** An eligible participant, indexed densely for array-based scoring. */
export interface ScoredParticipant {
  index: number;
  participantId: string;
  departmentKey: number;
  courseKey: number;
  answeredCount: number;
  missedCount: number;
}

export interface ScoringContext {
  questionCount: number;
  weights: Float64Array;
  /** Flat participantCount * questionCount matrix. -1 means no usable answer. */
  answers: Int32Array;
  participants: ScoredParticipant[];
  config: MatchingConfig;
}

export interface PairScorer {
  score(a: number, b: number): number;
}

export interface GroupPlan {
  sizes: number[];
  seated: number;
  overflow: number;
  effectiveMinSize: number;
  effectiveMaxSize: number;
}

export interface Failure {
  ok: false;
  error: string;
  warnings: string[];
}

export interface Success<T> {
  ok: true;
  value: T;
  warnings: string[];
}

export type Result<T> = Success<T> | Failure;

export function ok<T>(value: T, warnings: string[] = []): Success<T> {
  return { ok: true, value, warnings };
}

export function fail(error: string, warnings: string[] = []): Failure {
  return { ok: false, error, warnings };
}
