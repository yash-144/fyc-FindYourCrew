/**
 * Validation and canonicalisation.
 *
 * Canonicalisation matters more than it looks. The contract says
 * "same input + same seed = same output", but Postgres does not guarantee row
 * order without ORDER BY, so an unsorted fetch is not actually the same input
 * twice. Everything is sorted by stable keys here before any scoring happens.
 */

import type {
  GroupPlan,
  MatchingGroup,
  MatchingInput,
  MatchingOption,
  MatchingOutput,
  MatchingParticipant,
  MatchingQuestion,
  MatchingResponse,
  MatchingUnmatched,
  Result,
} from "./types";
import { fail, ok } from "./types";

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface CanonicalInput {
  eventId: string;
  seed: string;
  participants: MatchingParticipant[];
  questions: MatchingQuestion[];
  options: MatchingOption[];
  responsesByParticipant: Map<string, MatchingResponse[]>;
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export function validateInput(input: MatchingInput): Result<CanonicalInput> {
  const warnings: string[] = [];

  if (typeof input.eventId !== "string" || input.eventId.trim() === "") {
    return fail("eventId is required");
  }
  if (typeof input.seed !== "string" || input.seed.trim() === "") {
    return fail("seed is required and must be a non-empty string");
  }
  if (!Array.isArray(input.participants)) return fail("participants must be an array");
  if (!Array.isArray(input.questions)) return fail("questions must be an array");
  if (!Array.isArray(input.options)) return fail("options must be an array");
  if (!Array.isArray(input.responses)) return fail("responses must be an array");
  if (input.groupSizePolicy === undefined || input.groupSizePolicy === null) {
    return fail("groupSizePolicy is required");
  }
  if (input.groupSizePolicy.mode !== "fixed" && input.groupSizePolicy.mode !== "flexible") {
    return fail('groupSizePolicy.mode must be "fixed" or "flexible"');
  }
  if (input.participants.length === 0) return fail("participants must not be empty");

  const participantIds = new Set<string>();
  for (const participant of input.participants) {
    if (typeof participant.participantId !== "string" || participant.participantId === "") {
      return fail("every participant requires a non-empty participantId");
    }
    if (participantIds.has(participant.participantId)) {
      return fail(`duplicate participantId in input: ${participant.participantId}`);
    }
    participantIds.add(participant.participantId);
  }

  const questionIds = new Set<string>();
  for (const question of input.questions) {
    if (typeof question.questionId !== "string" || question.questionId === "") {
      return fail("every question requires a non-empty questionId");
    }
    if (questionIds.has(question.questionId)) {
      return fail(`duplicate questionId in input: ${question.questionId}`);
    }
    questionIds.add(question.questionId);
  }
  if (input.questions.length === 0) {
    warnings.push("no questions supplied; every pair scores 0 and grouping is effectively random");
  }

  const optionIds = new Set<string>();
  const options: MatchingOption[] = [];
  for (const option of input.options) {
    if (typeof option.optionId !== "string" || option.optionId === "") {
      return fail("every option requires a non-empty optionId");
    }
    if (optionIds.has(option.optionId)) {
      return fail(`duplicate optionId in input: ${option.optionId}`);
    }
    optionIds.add(option.optionId);
    if (!questionIds.has(option.questionId)) {
      warnings.push(`option ${option.optionId} references unknown question; ignored`);
      continue;
    }
    options.push(option);
  }

  // Response rows referencing unknown entities are dropped with a warning
  // rather than failing the run: live event data drifts, and refusing to match
  // 1000 students because of one stale row is the wrong trade.
  const responsesByParticipant = new Map<string, MatchingResponse[]>();
  const seenResponseKeys = new Set<string>();
  let droppedUnknown = 0;
  let droppedDuplicate = 0;

  for (const response of input.responses) {
    if (!participantIds.has(response.participantId) || !questionIds.has(response.questionId)) {
      droppedUnknown += 1;
      continue;
    }
    if (response.optionId !== null && !optionIds.has(response.optionId)) {
      droppedUnknown += 1;
      continue;
    }
    const key = `${response.participantId}\u0000${response.questionId}`;
    if (seenResponseKeys.has(key)) {
      droppedDuplicate += 1;
      continue;
    }
    seenResponseKeys.add(key);
    const bucket = responsesByParticipant.get(response.participantId);
    if (bucket === undefined) {
      responsesByParticipant.set(response.participantId, [response]);
    } else {
      bucket.push(response);
    }
  }

  if (droppedUnknown > 0) {
    warnings.push(`${droppedUnknown} response row(s) referenced unknown IDs and were ignored`);
  }
  if (droppedDuplicate > 0) {
    warnings.push(
      `${droppedDuplicate} duplicate (participant, question) response row(s) were ignored; ` +
        `the first row in canonical order was kept`,
    );
  }

  const participants = input.participants
    .slice()
    .sort((a, b) => compareStrings(a.participantId, b.participantId));

  const questions = input.questions.slice().sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return compareStrings(a.questionId, b.questionId);
  });

  const sortedOptions = options.slice().sort((a, b) => {
    const byQuestion = compareStrings(a.questionId, b.questionId);
    if (byQuestion !== 0) return byQuestion;
    return compareStrings(a.optionId, b.optionId);
  });

  for (const bucket of responsesByParticipant.values()) {
    bucket.sort((a, b) => compareStrings(a.questionId, b.questionId));
  }

  return ok(
    {
      eventId: input.eventId,
      seed: input.seed,
      participants,
      questions,
      options: sortedOptions,
      responsesByParticipant,
    },
    warnings,
  );
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export interface OutputValidationArgs {
  groups: MatchingGroup[];
  unmatched: MatchingUnmatched[];
  knownParticipantIds: Set<string>;
  plan: GroupPlan;
}

/**
 * Enforces the contract's pre-persistence rules. Sizes are checked against the
 * *effective* plan, not the raw request policy, because oversize absorption can
 * legitimately produce a group of maxSize + 1. The persistence-layer validator
 * should read `audit.policy.effectiveMaxSize` for the same reason.
 */
export function validateOutput(args: OutputValidationArgs): Result<true> {
  const { groups, unmatched, knownParticipantIds, plan } = args;
  const seen = new Set<string>();

  for (const group of groups) {
    if (group.memberParticipantIds.length === 0) {
      return fail(`group ${group.code} is empty`);
    }
    if (group.code.trim() === "" || group.name.trim() === "") {
      return fail(`group ${group.temporaryId} is missing a code or name`);
    }
    if (
      group.memberParticipantIds.length < plan.effectiveMinSize ||
      group.memberParticipantIds.length > plan.effectiveMaxSize
    ) {
      return fail(
        `group ${group.code} has ${group.memberParticipantIds.length} members, ` +
          `outside the planned range ${plan.effectiveMinSize}-${plan.effectiveMaxSize}`,
      );
    }
    for (const participantId of group.memberParticipantIds) {
      if (!knownParticipantIds.has(participantId)) {
        return fail(`group ${group.code} contains unknown participant ${participantId}`);
      }
      if (seen.has(participantId)) {
        return fail(`participant ${participantId} appears in more than one group`);
      }
      seen.add(participantId);
    }
  }

  for (const entry of unmatched) {
    if (!knownParticipantIds.has(entry.participantId)) {
      return fail(`unmatched list contains unknown participant ${entry.participantId}`);
    }
    if (seen.has(entry.participantId)) {
      return fail(`participant ${entry.participantId} is both matched and unmatched`);
    }
    seen.add(entry.participantId);
  }

  if (seen.size !== knownParticipantIds.size) {
    return fail(
      `matched + unmatched is ${seen.size} but ${knownParticipantIds.size} participants were supplied`,
    );
  }

  const codes = new Set<string>();
  for (const group of groups) {
    if (codes.has(group.code)) return fail(`duplicate group code ${group.code}`);
    codes.add(group.code);
  }

  return ok(true);
}

/**
 * Convenience wrapper for the persistence layer (roadmap Stage 8).
 *
 * Re-derives the size bounds from `audit.policy` rather than from the original
 * request, which is the only correct source once oversize absorption is in play.
 */
export function validateMatchingOutput(
  output: MatchingOutput,
  knownParticipantIds: Iterable<string>,
): Result<true> {
  const policy = output.audit.policy;
  const minSize = typeof policy.effectiveMinSize === "number" ? policy.effectiveMinSize : 1;
  const maxSize = typeof policy.effectiveMaxSize === "number" ? policy.effectiveMaxSize : Infinity;
  return validateOutput({
    groups: output.groups,
    unmatched: output.unmatched,
    knownParticipantIds: new Set(knownParticipantIds),
    plan: {
      sizes: [],
      seated: output.audit.matchedCount,
      overflow: 0,
      effectiveMinSize: minSize,
      effectiveMaxSize: maxSize,
    },
  });
}

export { compareStrings };
