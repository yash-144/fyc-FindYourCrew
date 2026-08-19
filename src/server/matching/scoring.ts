/**
 * Scoring.
 *
 * Answer similarity is the dominant signal. Department/course only act as
 * tie-breakers: the bonuses are deliberately smaller than one question's
 * contribution to the normalised score, so they can never reorder two pairs
 * that differ in answer agreement.
 */

import type {
  MatchingConfig,
  MatchingOption,
  MatchingParticipant,
  MatchingQuestion,
  MatchingResponse,
  PairScorer,
  ScoredParticipant,
  ScoringContext,
} from "./types";

const NO_ANSWER = -1;

/** Interns normalised strings to dense integers for cheap comparison. */
function createInterner(): (value: string) => number {
  const table = new Map<string, number>();
  return function intern(value: string): number {
    const key = value.trim().toLowerCase();
    const existing = table.get(key);
    if (existing !== undefined) return existing;
    const next = table.size;
    table.set(key, next);
    return next;
  };
}

export interface BuildScoringContextArgs {
  participants: MatchingParticipant[];
  questions: MatchingQuestion[];
  options: MatchingOption[];
  responsesByParticipant: Map<string, MatchingResponse[]>;
  config: MatchingConfig;
}

export interface ScoringBuild {
  context: ScoringContext;
  /** Per participant, in the same order as `args.participants`. */
  missedCounts: number[];
}

/**
 * Builds the flat answer matrix. A cell holds a dense option index, or
 * NO_ANSWER when the participant missed the question, has no response row, or
 * points at an option that does not belong to that question.
 */
export function buildScoringContext(args: BuildScoringContextArgs): ScoringBuild {
  const { participants, questions, options, responsesByParticipant, config } = args;

  const questionIndex = new Map<string, number>();
  questions.forEach((question, index) => questionIndex.set(question.questionId, index));

  const optionIndex = new Map<string, number>();
  const optionQuestion = new Map<string, string>();
  options.forEach((option, index) => {
    optionIndex.set(option.optionId, index);
    optionQuestion.set(option.optionId, option.questionId);
  });

  const questionCount = questions.length;
  const weights = new Float64Array(questionCount);
  let weightSum = 0;
  questions.forEach((question, index) => {
    const weight = Number.isFinite(question.weight) && question.weight > 0 ? question.weight : 0;
    weights[index] = weight;
    weightSum += weight;
  });
  if (weightSum === 0) {
    for (let q = 0; q < questionCount; q += 1) weights[q] = 1;
  }

  const answers = new Int32Array(participants.length * questionCount).fill(NO_ANSWER);
  const internDepartment = createInterner();
  const internCourse = createInterner();

  const scored: ScoredParticipant[] = [];
  const missedCounts: number[] = [];

  participants.forEach((participant, pIndex) => {
    const rows = responsesByParticipant.get(participant.participantId) ?? [];
    let answered = 0;
    for (const row of rows) {
      if (row.status !== "ANSWERED" || row.optionId === null) continue;
      const q = questionIndex.get(row.questionId);
      if (q === undefined) continue;
      const o = optionIndex.get(row.optionId);
      if (o === undefined) continue;
      if (optionQuestion.get(row.optionId) !== row.questionId) continue;
      const cell = pIndex * questionCount + q;
      if (answers[cell] === NO_ANSWER) answered += 1;
      answers[cell] = o;
    }
    const missed = questionCount - answered;
    missedCounts.push(missed);
    scored.push({
      index: pIndex,
      participantId: participant.participantId,
      departmentKey: internDepartment(participant.department),
      courseKey: internCourse(participant.course),
      answeredCount: answered,
      missedCount: missed,
    });
  });

  return {
    context: { questionCount, weights, answers, participants: scored, config },
    missedCounts,
  };
}

/**
 * Raw pair score.
 *
 *   base      = agreed weight / comparable weight   (0 when nothing comparable)
 *   diversity = department bonus + course bonus     (only when comparable)
 *   score     = min(base + diversity, config.maxPairScore)
 *
 * Missed answers are ignored on both sides rather than penalised, so a
 * participant with two blanks is judged only on what they did answer.
 */
export function computePairScore(context: ScoringContext, a: number, b: number): number {
  const { questionCount, weights, answers, participants, config } = context;
  const offsetA = a * questionCount;
  const offsetB = b * questionCount;

  let comparableWeight = 0;
  let agreedWeight = 0;
  for (let q = 0; q < questionCount; q += 1) {
    const va = answers[offsetA + q] as number;
    if (va === NO_ANSWER) continue;
    const vb = answers[offsetB + q] as number;
    if (vb === NO_ANSWER) continue;
    const w = weights[q] as number;
    comparableWeight += w;
    if (va === vb) agreedWeight += w;
  }

  if (comparableWeight === 0) return 0;

  const pa = participants[a] as ScoredParticipant;
  const pb = participants[b] as ScoredParticipant;
  let score = agreedWeight / comparableWeight;
  if (pa.departmentKey !== pb.departmentKey) score += config.differentDepartmentBonus;
  if (pa.courseKey !== pb.courseKey) score += config.differentCourseBonus;

  return score > config.maxPairScore ? config.maxPairScore : score;
}

/** Number of comparable (both-answered) questions for a pair. */
export function countComparableQuestions(context: ScoringContext, a: number, b: number): number {
  const { questionCount, answers } = context;
  const offsetA = a * questionCount;
  const offsetB = b * questionCount;
  let shared = 0;
  for (let q = 0; q < questionCount; q += 1) {
    if (answers[offsetA + q] === NO_ANSWER) continue;
    if (answers[offsetB + q] === NO_ANSWER) continue;
    shared += 1;
  }
  return shared;
}

function pairSlot(a: number, b: number, n: number): number {
  return (a * (2 * n - a - 1)) / 2 + (b - a - 1);
}

/**
 * Pair scorer. Precomputes the full triangle when the population is small
 * enough (n = 1000 costs ~2 MB as Float32), otherwise computes on demand.
 */
export function createPairScorer(context: ScoringContext): PairScorer {
  const n = context.participants.length;
  if (n < 2) {
    return { score: () => 0 };
  }
  if (n > context.config.precomputePairLimit) {
    return {
      score(a: number, b: number): number {
        if (a === b) return 0;
        return a < b ? computePairScore(context, a, b) : computePairScore(context, b, a);
      },
    };
  }

  const table = new Float32Array((n * (n - 1)) / 2);
  for (let a = 0; a < n - 1; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      table[pairSlot(a, b, n)] = computePairScore(context, a, b);
    }
  }
  return {
    score(a: number, b: number): number {
      if (a === b) return 0;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      return table[pairSlot(lo, hi, n)] as number;
    },
  };
}

/** Sum of intra-group pair scores. Iterated in index order for float stability. */
export function sumGroupPairScores(members: readonly number[], scorer: PairScorer): number {
  let total = 0;
  for (let i = 0; i < members.length - 1; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      total += scorer.score(members[i] as number, members[j] as number);
    }
  }
  return total;
}

/** Average pair score, normalised to 0..1 against `config.maxPairScore`. */
export function normalisedGroupScore(
  members: readonly number[],
  scorer: PairScorer,
  config: MatchingConfig,
): number {
  const pairCount = (members.length * (members.length - 1)) / 2;
  if (pairCount === 0) return 0;
  const average = sumGroupPairScores(members, scorer) / pairCount;
  const normalised = average / config.maxPairScore;
  if (normalised <= 0) return 0;
  if (normalised >= 1) return 1;
  return Math.round(normalised * 10000) / 10000;
}
