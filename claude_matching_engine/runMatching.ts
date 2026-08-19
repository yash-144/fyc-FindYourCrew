/**
 * Entry point.
 *
 *   const output = await runMatching(input);
 *   const output = await runMatching(input, { allowOversizeGroups: false });
 *
 * The module is pure: it reads its input, returns its output, and touches no
 * database, network, filesystem, browser or Next.js API. The only ambient call
 * is `Date.now()` for the audit duration, which does not affect grouping.
 */

import type {
  MatchingAudit,
  MatchingConfig,
  MatchingConfigOverrides,
  MatchingGroup,
  MatchingInput,
  MatchingOutput,
  MatchingParticipant,
  MatchingUnmatched,
  PairScorer,
  ScoringContext,
  UnmatchedReason,
} from "./types";
import { createSeededRandom, seededShuffle } from "./prng";
import {
  buildScoringContext,
  countComparableQuestions,
  createPairScorer,
  normalisedGroupScore,
} from "./scoring";
import {
  buildGreedyGroups,
  collectUnassigned,
  planGroupSizes,
  resolveIterationBudget,
  runLocalSearch,
} from "./grouping";
import { makeGroupCode, makeGroupName, makeTemporaryId, pickIcebreaker } from "./naming";
import { validateInput, validateOutput } from "./validation";

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxMissedAnswers: 2,
  excludeLateJoiners: false,
  allowOversizeGroups: true,
  defaultMinSize: 4,
  defaultMaxSize: 5,
  differentDepartmentBonus: 0.03,
  differentCourseBonus: 0.02,
  maxPairScore: 1.05,
  localSearchIterations: "auto",
  candidateWindow: 512,
  precomputePairLimit: 3000,
  includeExplanations: true,
};

export function resolveConfig(overrides: MatchingConfigOverrides = {}): MatchingConfig {
  return { ...DEFAULT_MATCHING_CONFIG, ...overrides };
}

interface EligibilitySplit {
  eligible: MatchingParticipant[];
  excluded: MatchingUnmatched[];
}

/**
 * `REMOVED` is not in the contract's status union, but stale callers do send it.
 * The runtime check is deliberate; the cast is the justification for it.
 */
function isRemoved(participant: MatchingParticipant): boolean {
  return (participant.status as string) === "REMOVED";
}

function splitByEligibility(
  participants: MatchingParticipant[],
  missedCounts: number[],
  config: MatchingConfig,
): EligibilitySplit {
  const eligible: MatchingParticipant[] = [];
  const excluded: MatchingUnmatched[] = [];

  participants.forEach((participant, index) => {
    if (isRemoved(participant)) {
      excluded.push({ participantId: participant.participantId, reason: "removed" });
      return;
    }
    if (config.excludeLateJoiners && participant.status === "LATE") {
      excluded.push({ participantId: participant.participantId, reason: "late_join" });
      return;
    }
    if ((missedCounts[index] as number) > config.maxMissedAnswers) {
      excluded.push({
        participantId: participant.participantId,
        reason: "too_many_missing_answers",
      });
      return;
    }
    eligible.push(participant);
  });

  return { eligible, excluded };
}

function describeGroup(
  members: readonly number[],
  context: ScoringContext,
  scorer: PairScorer,
  participants: readonly MatchingParticipant[],
): string {
  const score = normalisedGroupScore(members, scorer, context.config);
  let sharedTotal = 0;
  let pairs = 0;
  for (let i = 0; i < members.length - 1; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      sharedTotal += countComparableQuestions(context, members[i] as number, members[j] as number);
      pairs += 1;
    }
  }
  const averageShared = pairs === 0 ? 0 : Math.round(sharedTotal / pairs);
  const departments = new Set<string>();
  for (const member of members) {
    departments.add((participants[member] as MatchingParticipant).department.trim().toLowerCase());
  }
  const overlap = Math.round(score * 100);
  const mix =
    departments.size === 1 ? "same department" : `${departments.size} departments represented`;
  return `${overlap}% answer overlap across ~${averageShared} shared question(s), ${mix}.`;
}

function buildAudit(args: {
  input: MatchingInput;
  config: MatchingConfig;
  matchableCount: number;
  matchedCount: number;
  unmatchedCount: number;
  groupCount: number;
  startedAt: number;
  warnings: string[];
  extraPolicy?: Record<string, unknown>;
}): MatchingAudit {
  const { input, config } = args;
  return {
    eventId: typeof input.eventId === "string" ? input.eventId : "",
    seed: typeof input.seed === "string" ? input.seed : "",
    participantCount: Array.isArray(input.participants) ? input.participants.length : 0,
    matchableCount: args.matchableCount,
    matchedCount: args.matchedCount,
    unmatchedCount: args.unmatchedCount,
    groupCount: args.groupCount,
    durationMs: Date.now() - args.startedAt,
    policy: {
      mode: input.groupSizePolicy?.mode ?? null,
      fixedSize: input.groupSizePolicy?.fixedSize ?? null,
      minSize: input.groupSizePolicy?.minSize ?? null,
      maxSize: input.groupSizePolicy?.maxSize ?? null,
      maxMissedAnswers: config.maxMissedAnswers,
      excludeLateJoiners: config.excludeLateJoiners,
      allowOversizeGroups: config.allowOversizeGroups,
      differentDepartmentBonus: config.differentDepartmentBonus,
      differentCourseBonus: config.differentCourseBonus,
      maxPairScore: config.maxPairScore,
      algorithmVersion: "mvp-greedy-localsearch-1",
      ...(args.extraPolicy ?? {}),
    },
    warnings: args.warnings,
  };
}

function buildFailure(args: {
  input: MatchingInput;
  config: MatchingConfig;
  startedAt: number;
  error: string;
  warnings: string[];
  reason: UnmatchedReason;
}): MatchingOutput {
  const participants = Array.isArray(args.input.participants) ? args.input.participants : [];
  const unmatched: MatchingUnmatched[] = participants
    .filter((participant) => typeof participant?.participantId === "string")
    .map((participant) => ({ participantId: participant.participantId, reason: args.reason }));

  return {
    success: false,
    groups: [],
    unmatched,
    audit: buildAudit({
      input: args.input,
      config: args.config,
      matchableCount: 0,
      matchedCount: 0,
      unmatchedCount: unmatched.length,
      groupCount: 0,
      startedAt: args.startedAt,
      warnings: args.warnings,
    }),
    error: args.error,
  };
}

export async function runMatching(
  input: MatchingInput,
  overrides: MatchingConfigOverrides = {},
): Promise<MatchingOutput> {
  const startedAt = Date.now();
  const config = resolveConfig(overrides);
  const warnings: string[] = [];

  try {
    const parsed = validateInput(input);
    if (!parsed.ok) {
      return buildFailure({
        input,
        config,
        startedAt,
        error: parsed.error,
        warnings: parsed.warnings,
        reason: "algorithm_error",
      });
    }
    warnings.push(...parsed.warnings);
    const canonical = parsed.value;

    if (canonical.questions.length - config.maxMissedAnswers < 2) {
      warnings.push(
        `maxMissedAnswers (${config.maxMissedAnswers}) leaves fewer than 2 guaranteed answers ` +
          `per participant across ${canonical.questions.length} question(s); similarity signal is weak`,
      );
    }

    // Score only eligible participants, so dense indices stay contiguous.
    const preliminary = buildScoringContext({
      participants: canonical.participants,
      questions: canonical.questions,
      options: canonical.options,
      responsesByParticipant: canonical.responsesByParticipant,
      config,
    });

    const split = splitByEligibility(
      canonical.participants,
      preliminary.missedCounts,
      config,
    );
    const eligible = split.eligible;
    const unmatched: MatchingUnmatched[] = split.excluded.slice();

    const plan = planGroupSizes(eligible.length, input.groupSizePolicy, config);
    if (!plan.ok) {
      return buildFailure({
        input,
        config,
        startedAt,
        error: plan.error,
        warnings: [...warnings, ...plan.warnings],
        reason: "algorithm_error",
      });
    }
    warnings.push(...plan.warnings);

    const built = buildScoringContext({
      participants: eligible,
      questions: canonical.questions,
      options: canonical.options,
      responsesByParticipant: canonical.responsesByParticipant,
      config,
    });
    const context = built.context;
    const scorer = createPairScorer(context);
    const random = createSeededRandom(`${canonical.seed}|${canonical.eventId}`);

    const order = seededShuffle(
      eligible.map((_, index) => index),
      random,
    );

    const memberIndexGroups = buildGreedyGroups(order, plan.value, scorer, config);
    const iterations = resolveIterationBudget(eligible.length, config);
    const search = runLocalSearch(memberIndexGroups, scorer, random, iterations);

    for (const index of collectUnassigned(order, memberIndexGroups)) {
      unmatched.push({
        participantId: (eligible[index] as MatchingParticipant).participantId,
        reason: "overflow",
      });
    }

    const usedNames = new Set<string>();
    const groups: MatchingGroup[] = memberIndexGroups.map((members, position) => {
      // Sort members so persisted rows are stable regardless of swap history.
      const sorted = members
        .slice()
        .sort((a, b) =>
          (eligible[a] as MatchingParticipant).participantId <
          (eligible[b] as MatchingParticipant).participantId
            ? -1
            : 1,
        );
      const ordinal = position + 1;
      const group: MatchingGroup = {
        temporaryId: makeTemporaryId(canonical.seed, canonical.eventId, ordinal),
        code: makeGroupCode(ordinal, memberIndexGroups.length),
        name: makeGroupName(canonical.seed, canonical.eventId, ordinal, usedNames),
        icebreakerPrompt: pickIcebreaker(canonical.seed, canonical.eventId, ordinal),
        memberParticipantIds: sorted.map(
          (index) => (eligible[index] as MatchingParticipant).participantId,
        ),
        score: normalisedGroupScore(sorted, scorer, config),
      };
      if (config.includeExplanations) {
        group.explanation = describeGroup(sorted, context, scorer, eligible);
      }
      return group;
    });

    unmatched.sort((a, b) => (a.participantId < b.participantId ? -1 : 1));

    const knownParticipantIds = new Set(
      canonical.participants.map((participant) => participant.participantId),
    );
    const outputCheck = validateOutput({
      groups,
      unmatched,
      knownParticipantIds,
      plan: plan.value,
    });
    if (!outputCheck.ok) {
      return buildFailure({
        input,
        config,
        startedAt,
        error: `output validation failed: ${outputCheck.error}`,
        warnings,
        reason: "algorithm_error",
      });
    }

    const matchedCount = groups.reduce(
      (total, group) => total + group.memberParticipantIds.length,
      0,
    );

    return {
      success: true,
      groups,
      unmatched,
      audit: buildAudit({
        input,
        config,
        matchableCount: eligible.length,
        matchedCount,
        unmatchedCount: unmatched.length,
        groupCount: groups.length,
        startedAt,
        warnings,
        extraPolicy: {
          effectiveMinSize: plan.value.effectiveMinSize,
          effectiveMaxSize: plan.value.effectiveMaxSize,
          plannedGroupSizes: plan.value.sizes.slice(),
          localSearchIterations: search.iterations,
          localSearchSwapsApplied: search.swapsApplied,
          localSearchImprovement: Math.round(search.improvement * 10000) / 10000,
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure({
      input,
      config,
      startedAt,
      error: `unexpected matching failure: ${message}`,
      warnings,
      reason: "algorithm_error",
    });
  }
}
