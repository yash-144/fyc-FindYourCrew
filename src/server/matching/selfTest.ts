/**
 * Dependency-free self tests.
 *
 * There is no assumption about a test runner here. `runSelfTests()` returns
 * structured results, so it can be wrapped by vitest/jest later, called from a
 * throwaway script, or executed directly:
 *
 *   npx tsx src/server/matching/selfTest.ts
 *
 * If you add vitest, each case below maps one-to-one onto an `it(...)`.
 */

import { runMatching } from "./runMatching";
import { buildScoringContext, computePairScore } from "./scoring";
import { resolveConfig } from "./runMatching";
import { stableHash } from "./prng";
import type {
  MatchingInput,
  MatchingOption,
  MatchingParticipant,
  MatchingQuestion,
  MatchingResponse,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Tiny assertion helpers                                                     */
/* -------------------------------------------------------------------------- */

class AssertionError extends Error {}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new AssertionError(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic synthetic data                                               */
/* -------------------------------------------------------------------------- */

const DEPARTMENTS = ["CSE", "ECE", "MECH", "CIVIL", "BBA", "BCOM"];
const COURSES = ["BTech", "BTechHons", "BBA", "BCom", "BSc"];

function pseudoRandom(seed: string): () => number {
  let state = stableHash(seed) || 1;
  return function next(): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface SyntheticOptions {
  participantCount: number;
  questionCount: number;
  optionsPerQuestion: number;
  missRate: number;
  seed: string;
}

function makeSynthetic(config: SyntheticOptions): MatchingInput {
  const random = pseudoRandom(`synthetic|${config.seed}`);

  const questions: MatchingQuestion[] = [];
  const options: MatchingOption[] = [];
  for (let q = 0; q < config.questionCount; q += 1) {
    const questionId = `q-${String(q).padStart(3, "0")}`;
    questions.push({ questionId, position: q + 1, weight: 1 });
    for (let o = 0; o < config.optionsPerQuestion; o += 1) {
      options.push({
        optionId: `${questionId}-opt-${o}`,
        questionId,
        optionKey: String.fromCharCode(65 + o),
      });
    }
  }

  const participants: MatchingParticipant[] = [];
  const responses: MatchingResponse[] = [];
  for (let p = 0; p < config.participantCount; p += 1) {
    const participantId = `p-${String(p).padStart(4, "0")}`;
    participants.push({
      participantId,
      profileId: `profile-${participantId}`,
      fullName: `Student ${p}`,
      department: DEPARTMENTS[p % DEPARTMENTS.length] as string,
      course: COURSES[p % COURSES.length] as string,
      joinedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, p % 60)).toISOString(),
      status: p % 17 === 0 ? "LATE" : "ACTIVE",
    });

    for (let q = 0; q < config.questionCount; q += 1) {
      const questionId = `q-${String(q).padStart(3, "0")}`;
      if (random() < config.missRate) {
        responses.push({ participantId, questionId, optionId: null, status: "MISSED", updatedAt: null });
        continue;
      }
      const optionIndex = Math.floor(random() * config.optionsPerQuestion);
      responses.push({
        participantId,
        questionId,
        optionId: `${questionId}-opt-${optionIndex}`,
        status: "ANSWERED",
        updatedAt: new Date(Date.UTC(2026, 0, 1, 10, 5, q)).toISOString(),
      });
    }
  }

  return {
    eventId: "event-selftest",
    seed: config.seed,
    groupSizePolicy: { mode: "flexible", minSize: 4, maxSize: 5 },
    participants,
    questions,
    responses,
    options,
  };
}

/** Two tight answer clusters with intentionally misleading department signals. */
function makeClusteredInput(): MatchingInput {
  const questions: MatchingQuestion[] = [];
  const options: MatchingOption[] = [];
  for (let q = 0; q < 6; q += 1) {
    const questionId = `q${q}`;
    questions.push({ questionId, position: q + 1, weight: 1 });
    options.push({ optionId: `${questionId}-A`, questionId, optionKey: "A" });
    options.push({ optionId: `${questionId}-B`, questionId, optionKey: "B" });
  }

  const participants: MatchingParticipant[] = [];
  const responses: MatchingResponse[] = [];
  for (let p = 0; p < 8; p += 1) {
    const cluster = p < 4 ? "A" : "B";
    const participantId = `c${cluster}-${p}`;
    participants.push({
      participantId,
      profileId: `profile-${participantId}`,
      fullName: `Cluster ${cluster} ${p}`,
      // Department mirrors the cluster, so a department-diversity bonus that was
      // too strong would actively pull the clusters apart.
      department: cluster === "A" ? "CSE" : "MECH",
      course: cluster === "A" ? "BTech" : "BBA",
      joinedAt: "2026-01-01T10:00:00.000Z",
      status: "ACTIVE",
    });
    for (let q = 0; q < 6; q += 1) {
      responses.push({
        participantId,
        questionId: `q${q}`,
        optionId: `q${q}-${cluster}`,
        status: "ANSWERED",
        updatedAt: "2026-01-01T10:05:00.000Z",
      });
    }
  }

  return {
    eventId: "event-cluster",
    seed: "cluster-seed",
    groupSizePolicy: { mode: "flexible", minSize: 4, maxSize: 5 },
    participants,
    questions,
    responses,
    options,
  };
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

interface TestCase {
  name: string;
  run: () => Promise<void>;
}

const cases: TestCase[] = [
  {
    name: "same input and seed produce byte-identical output",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 120,
        questionCount: 8,
        optionsPerQuestion: 4,
        missRate: 0.08,
        seed: "determinism-seed",
      });
      const a = await runMatching(input);
      const b = await runMatching(input);
      assert(a.success && b.success, "both runs should succeed");
      assertEqual(
        JSON.stringify({ groups: a.groups, unmatched: a.unmatched }),
        JSON.stringify({ groups: b.groups, unmatched: b.unmatched }),
        "repeat run diverged",
      );
    },
  },
  {
    name: "shuffled input row order does not change output",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 90,
        questionCount: 7,
        optionsPerQuestion: 4,
        missRate: 0.1,
        seed: "order-seed",
      });
      const shuffledRandom = pseudoRandom("shuffle");
      const shuffle = <T,>(items: T[]): T[] => {
        const out = items.slice();
        for (let i = out.length - 1; i > 0; i -= 1) {
          const j = Math.floor(shuffledRandom() * (i + 1));
          const tmp = out[i] as T;
          out[i] = out[j] as T;
          out[j] = tmp;
        }
        return out;
      };
      const reordered: MatchingInput = {
        ...input,
        participants: shuffle(input.participants),
        questions: shuffle(input.questions),
        options: shuffle(input.options),
        responses: shuffle(input.responses),
      };
      const a = await runMatching(input);
      const b = await runMatching(reordered);
      assertEqual(
        JSON.stringify(a.groups),
        JSON.stringify(b.groups),
        "output changed when input arrays were reordered",
      );
    },
  },
  {
    name: "different seed produces a different arrangement",
    run: async () => {
      const base = makeSynthetic({
        participantCount: 100,
        questionCount: 8,
        optionsPerQuestion: 4,
        missRate: 0.05,
        seed: "seed-one",
      });
      const a = await runMatching(base);
      const b = await runMatching({ ...base, seed: "seed-two" });
      assert(
        JSON.stringify(a.groups) !== JSON.stringify(b.groups),
        "seed had no effect on grouping",
      );
    },
  },
  {
    name: "duplicate participant IDs are rejected",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 10,
        questionCount: 5,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "dupes",
      });
      input.participants.push({ ...(input.participants[0] as MatchingParticipant) });
      const output = await runMatching(input);
      assertEqual(output.success, false, "duplicate IDs should fail the run");
      assert(
        (output.error ?? "").includes("duplicate participantId"),
        `unexpected error: ${output.error ?? "none"}`,
      );
    },
  },
  {
    name: "no participant appears in two groups",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 317,
        questionCount: 9,
        optionsPerQuestion: 4,
        missRate: 0.12,
        seed: "no-dupes",
      });
      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      const seen = new Set<string>();
      for (const group of output.groups) {
        for (const id of group.memberParticipantIds) {
          assert(!seen.has(id), `participant ${id} appeared twice`);
          seen.add(id);
        }
      }
    },
  },
  {
    name: "matched plus unmatched equals every supplied participant, exactly once",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 233,
        questionCount: 8,
        optionsPerQuestion: 4,
        missRate: 0.2,
        seed: "conservation",
      });
      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      const seen = new Set<string>();
      for (const group of output.groups) for (const id of group.memberParticipantIds) seen.add(id);
      for (const entry of output.unmatched) {
        assert(!seen.has(entry.participantId), `${entry.participantId} matched and unmatched`);
        seen.add(entry.participantId);
      }
      assertEqual(seen.size, input.participants.length, "participant conservation broken");
      assertEqual(
        output.audit.matchedCount + output.audit.unmatchedCount,
        output.audit.participantCount,
        "audit counts do not reconcile",
      );
    },
  },
  {
    name: "more than two missed answers excludes a participant",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 40,
        questionCount: 8,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "missing",
      });
      const victim = (input.participants[3] as MatchingParticipant).participantId;
      const borderline = (input.participants[7] as MatchingParticipant).participantId;
      input.responses = input.responses.map((row) => {
        const isVictim = row.participantId === victim && row.questionId <= "q-002";
        const isBorderline = row.participantId === borderline && row.questionId <= "q-001";
        if (isVictim || isBorderline) {
          return { ...row, optionId: null, status: "MISSED" as const, updatedAt: null };
        }
        return row;
      });

      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      const reasons = new Map(output.unmatched.map((entry) => [entry.participantId, entry.reason]));
      assertEqual(
        reasons.get(victim),
        "too_many_missing_answers",
        "3 misses should exclude the participant",
      );
      assert(
        reasons.get(borderline) !== "too_many_missing_answers",
        "2 misses should still be matchable",
      );
    },
  },
  {
    name: "fixed group size produces exact sizes and overflow",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 103,
        questionCount: 6,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "fixed",
      });
      input.groupSizePolicy = { mode: "fixed", fixedSize: 4 };
      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      for (const group of output.groups) {
        assertEqual(group.memberParticipantIds.length, 4, `group ${group.code} is not size 4`);
      }
      assertEqual(output.groups.length, 25, "expected 25 groups of 4");
      const overflow = output.unmatched.filter((entry) => entry.reason === "overflow");
      assertEqual(overflow.length, 3, "expected 3 overflow participants");
    },
  },
  {
    name: "flexible policy keeps groups within 4-5 when oversize is disabled",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 500,
        questionCount: 8,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "flexible",
      });
      const output = await runMatching(input, { allowOversizeGroups: false });
      assert(output.success, output.error ?? "run failed");
      for (const group of output.groups) {
        const size = group.memberParticipantIds.length;
        assert(size >= 4 && size <= 5, `group ${group.code} has size ${size}`);
      }
      assertEqual(output.unmatched.length, 0, "500 should divide cleanly into 4-5 groups");
    },
  },
  {
    name: "oversize absorption seats leftovers instead of orphaning them",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 11,
        questionCount: 6,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "oversize",
      });
      const strict = await runMatching(input, { allowOversizeGroups: false });
      assertEqual(strict.unmatched.length, 1, "strict mode should orphan exactly one person");

      const relaxed = await runMatching(input, { allowOversizeGroups: true });
      assertEqual(relaxed.unmatched.length, 0, "relaxed mode should seat everyone");
      const sizes = relaxed.groups.map((group) => group.memberParticipantIds.length).sort();
      assertEqual(JSON.stringify(sizes), JSON.stringify([5, 6]), "unexpected group sizes");
    },
  },
  {
    name: "department and course bonuses never outrank answer similarity",
    run: async () => {
      const config = resolveConfig();
      const input = makeClusteredInput();
      const built = buildScoringContext({
        participants: input.participants,
        questions: input.questions,
        options: input.options,
        responsesByParticipant: new Map(
          input.participants.map((participant) => [
            participant.participantId,
            input.responses.filter((row) => row.participantId === participant.participantId),
          ]),
        ),
        config,
      });
      const sameCluster = computePairScore(built.context, 0, 1);
      const crossCluster = computePairScore(built.context, 0, 5);
      assert(
        sameCluster > crossCluster,
        `identical answers (${sameCluster}) should beat maximum diversity (${crossCluster})`,
      );

      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      for (const group of output.groups) {
        const prefixes = new Set(group.memberParticipantIds.map((id) => id.slice(0, 2)));
        assertEqual(prefixes.size, 1, `group ${group.code} mixed the answer clusters`);
      }
    },
  },
  {
    name: "excludeLateJoiners reports late_join",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 60,
        questionCount: 6,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "late",
      });
      const output = await runMatching(input, { excludeLateJoiners: true });
      assert(output.success, output.error ?? "run failed");
      const lateCount = output.unmatched.filter((entry) => entry.reason === "late_join").length;
      assert(lateCount > 0, "expected some late joiners to be excluded");
    },
  },
  {
    name: "removed participants are excluded defensively",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 20,
        questionCount: 5,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "removed",
      });
      const target = input.participants[2] as MatchingParticipant;
      (target as { status: string }).status = "REMOVED";
      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      const entry = output.unmatched.find((row) => row.participantId === target.participantId);
      assertEqual(entry?.reason, "removed", "REMOVED status was not honoured");
    },
  },
  {
    name: "below-minSize participant count leaves everyone as overflow, not a thrown error",
    run: async () => {
      // This is the shape workflow.ts's default policy hands to the algorithm
      // before its small-count guard runs: minSize 4 with only 1 participant.
      // Documents the actual failure mode (silent empty-groups success) so a
      // future edit to grouping.ts that changes this can't regress unnoticed.
      const input = makeSynthetic({
        participantCount: 1,
        questionCount: 5,
        optionsPerQuestion: 4,
        missRate: 0,
        seed: "solo",
      });
      const output = await runMatching(input);
      assert(output.success, output.error ?? "run failed");
      assertEqual(output.groups.length, 0, "expected zero groups below minSize");
      assertEqual(output.unmatched.length, 1, "the lone participant should be unmatched");
      assertEqual(output.unmatched[0]?.reason, "overflow", "expected overflow, not exclusion");
    },
  },
  {
    name: "minSize clamped to participant count seats everyone for small events",
    run: async () => {
      // Mirrors workflow.ts's `minSize: Math.min(4, participants.length)` guard
      // for 2- and 3-participant events.
      for (const count of [2, 3]) {
        const input = makeSynthetic({
          participantCount: count,
          questionCount: 5,
          optionsPerQuestion: 4,
          missRate: 0,
          seed: `clamped-${count}`,
        });
        input.groupSizePolicy = { mode: "flexible", minSize: Math.min(4, count), maxSize: 6 };
        const output = await runMatching(input);
        assert(output.success, `count=${count}: ${output.error ?? "run failed"}`);
        assertEqual(output.groups.length, 1, `count=${count}: expected exactly one group`);
        assertEqual(
          output.groups[0]?.memberParticipantIds.length,
          count,
          `count=${count}: group should contain everyone`,
        );
        assertEqual(output.unmatched.length, 0, `count=${count}: nobody should be unmatched`);
      }
    },
  },
  {
    name: "1000 participants complete well inside the 5 second budget",
    run: async () => {
      const input = makeSynthetic({
        participantCount: 1000,
        questionCount: 10,
        optionsPerQuestion: 4,
        missRate: 0.06,
        seed: "load-test",
      });
      const started = Date.now();
      const output = await runMatching(input);
      const elapsed = Date.now() - started;
      assert(output.success, output.error ?? "run failed");
      assert(elapsed < 5000, `took ${elapsed}ms, budget is 5000ms`);
      // eslint-disable-next-line no-console
      console.log(
        `      1000 participants: ${elapsed}ms, ${output.groups.length} groups, ` +
          `${output.unmatched.length} unmatched`,
      );
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

export interface SelfTestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export async function runSelfTests(): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  for (const testCase of cases) {
    const started = Date.now();
    try {
      await testCase.run();
      results.push({ name: testCase.name, passed: true, durationMs: Date.now() - started });
    } catch (error) {
      results.push({
        name: testCase.name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}

export async function reportSelfTests(): Promise<boolean> {
  const results = await runSelfTests();
  let failures = 0;
  for (const result of results) {
    if (result.passed) {
      // eslint-disable-next-line no-console
      console.log(`  PASS  ${result.name} (${result.durationMs}ms)`);
    } else {
      failures += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL  ${result.name}\n        ${result.error ?? "unknown error"}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n${results.length - failures}/${results.length} passed`);
  return failures === 0;
}

/* -------------------------------------------------------------------------- */
/* CLI entry point — `npx tsx src/server/matching/selfTest.ts`                */
/* -------------------------------------------------------------------------- */

const isDirectRun = (() => {
  const entry = process.argv[1];
  return typeof entry === "string" && import.meta.url === `file://${entry}`;
})();

if (isDirectRun) {
  reportSelfTests().then((ok) => {
    process.exit(ok ? 0 : 1);
  });
}
