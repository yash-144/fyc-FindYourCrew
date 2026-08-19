/**
 * Grouping.
 *
 * Three phases, all deterministic given the seed:
 *   1. plan sizes   - decide how many groups of what size before placing anyone
 *   2. greedy seed  - fill each planned group with the best marginal candidate
 *   3. local search - bounded swap hill-climb on total intra-group pair score
 *
 * Group sizes are fixed by phase 1 and never change, so phase 3 only needs to
 * consider member-for-member swaps.
 */

import type {
  GroupPlan,
  GroupSizePolicy,
  MatchingConfig,
  PairScorer,
  Result,
} from "./types";
import { fail, ok } from "./types";
import type { SeededRandom } from "./prng";

/* -------------------------------------------------------------------------- */
/* Phase 1: size planning                                                     */
/* -------------------------------------------------------------------------- */

function planFixed(count: number, size: number): GroupPlan {
  const groupCount = Math.floor(count / size);
  const sizes = new Array<number>(groupCount).fill(size);
  const seated = groupCount * size;
  return {
    sizes,
    seated,
    overflow: count - seated,
    effectiveMinSize: size,
    effectiveMaxSize: size,
  };
}

function planFlexible(
  count: number,
  minSize: number,
  maxSize: number,
  allowOversize: boolean,
): GroupPlan {
  if (count < minSize) {
    return {
      sizes: [],
      seated: 0,
      overflow: count,
      effectiveMinSize: minSize,
      effectiveMaxSize: maxSize,
    };
  }

  // Pick the group count that seats the most people; break ties toward fewer
  // (therefore larger) groups.
  let bestGroups = 0;
  let bestSeated = -1;
  const upper = Math.floor(count / minSize);
  for (let groups = 1; groups <= upper; groups += 1) {
    const seated = Math.min(count, groups * maxSize);
    if (seated < groups * minSize) continue;
    if (seated > bestSeated) {
      bestSeated = seated;
      bestGroups = groups;
    }
  }

  if (bestGroups === 0) {
    return {
      sizes: [],
      seated: 0,
      overflow: count,
      effectiveMinSize: minSize,
      effectiveMaxSize: maxSize,
    };
  }

  const base = Math.floor(bestSeated / bestGroups);
  const larger = bestSeated - base * bestGroups;
  const sizes: number[] = [];
  for (let g = 0; g < bestGroups; g += 1) sizes.push(g < larger ? base + 1 : base);

  let leftover = count - bestSeated;
  let effectiveMaxSize = maxSize;
  if (allowOversize && leftover > 0) {
    const absorb = Math.min(leftover, sizes.length);
    for (let g = 0; g < absorb; g += 1) sizes[g] = (sizes[g] as number) + 1;
    leftover -= absorb;
    if (absorb > 0) effectiveMaxSize = Math.max(...sizes);
  }

  // Largest groups first keeps greedy placement stable.
  sizes.sort((a, b) => b - a);

  return {
    sizes,
    seated: count - leftover,
    overflow: leftover,
    effectiveMinSize: minSize,
    effectiveMaxSize,
  };
}

export function planGroupSizes(
  count: number,
  policy: GroupSizePolicy,
  config: MatchingConfig,
): Result<GroupPlan> {
  if (policy.mode === "fixed") {
    const size = policy.fixedSize;
    if (size === undefined || !Number.isInteger(size) || size < 2) {
      return fail("groupSizePolicy.fixedSize must be an integer of at least 2 in fixed mode");
    }
    if (size > 20) return fail("groupSizePolicy.fixedSize must not exceed 20");
    const plan = planFixed(count, size);
    const warnings: string[] = [];
    if (plan.overflow > 0) {
      warnings.push(
        `fixed size ${size} leaves ${plan.overflow} participant(s) as overflow; ` +
          `flexible mode would seat them`,
      );
    }
    return ok(plan, warnings);
  }

  const minSize = policy.minSize ?? config.defaultMinSize;
  const maxSize = policy.maxSize ?? config.defaultMaxSize;
  if (!Number.isInteger(minSize) || minSize < 2) {
    return fail("groupSizePolicy.minSize must be an integer of at least 2");
  }
  if (!Number.isInteger(maxSize) || maxSize < minSize) {
    return fail("groupSizePolicy.maxSize must be an integer greater than or equal to minSize");
  }
  if (maxSize > 20) return fail("groupSizePolicy.maxSize must not exceed 20");

  const plan = planFlexible(count, minSize, maxSize, config.allowOversizeGroups);
  const warnings: string[] = [];
  if (plan.effectiveMaxSize > maxSize) {
    warnings.push(
      `allowOversizeGroups absorbed leftover participants; largest group is ` +
        `${plan.effectiveMaxSize} (policy maxSize ${maxSize})`,
    );
  }
  if (plan.overflow > 0) {
    warnings.push(`${plan.overflow} participant(s) could not be seated and are overflow`);
  }
  return ok(plan, warnings);
}

/* -------------------------------------------------------------------------- */
/* Phase 2: greedy seeding                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fills planned groups one at a time. The seed member is taken from the front
 * of the shuffled order; every subsequent slot takes the unassigned candidate
 * with the highest total pair score against the members already placed.
 *
 * Candidate scanning is windowed. Scanning the whole remaining pool would push
 * globally similar participants into the same early groups and starve later
 * ones, and it costs more.
 */
export function buildGreedyGroups(
  order: readonly number[],
  plan: GroupPlan,
  scorer: PairScorer,
  config: MatchingConfig,
): number[][] {
  const pool = order.slice();
  const assigned = new Set<number>();
  const groups: number[][] = [];

  let cursor = 0;
  for (const size of plan.sizes) {
    while (cursor < pool.length && assigned.has(pool[cursor] as number)) cursor += 1;
    if (cursor >= pool.length) break;

    const seedMember = pool[cursor] as number;
    assigned.add(seedMember);
    cursor += 1;
    const members: number[] = [seedMember];

    while (members.length < size) {
      let bestCandidate = -1;
      let bestScore = Number.NEGATIVE_INFINITY;
      let scanned = 0;

      for (let i = cursor; i < pool.length && scanned < config.candidateWindow; i += 1) {
        const candidate = pool[i] as number;
        if (assigned.has(candidate)) continue;
        scanned += 1;
        let score = 0;
        for (const member of members) score += scorer.score(member, candidate);
        // Strict > keeps the earliest candidate in shuffled order on a tie,
        // which is what makes this reproducible.
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate === -1) break;
      assigned.add(bestCandidate);
      members.push(bestCandidate);
    }

    if (members.length === size) {
      groups.push(members);
    } else {
      // Could not complete this group; release members back to the pool.
      for (const member of members) assigned.delete(member);
      break;
    }
  }

  return groups;
}

export function collectUnassigned(
  order: readonly number[],
  groups: readonly number[][],
): number[] {
  const assigned = new Set<number>();
  for (const group of groups) for (const member of group) assigned.add(member);
  return order.filter((index) => !assigned.has(index));
}

/* -------------------------------------------------------------------------- */
/* Phase 3: local search                                                      */
/* -------------------------------------------------------------------------- */

export function resolveIterationBudget(
  participantCount: number,
  config: MatchingConfig,
): number {
  if (config.localSearchIterations !== "auto") {
    return Math.max(0, Math.floor(config.localSearchIterations));
  }
  return Math.min(20000, Math.max(2000, participantCount * 8));
}

export interface LocalSearchResult {
  swapsApplied: number;
  iterations: number;
  improvement: number;
}

/**
 * Bounded swap hill-climb. Groups keep their planned sizes because only
 * member-for-member exchanges are considered.
 */
export function runLocalSearch(
  groups: number[][],
  scorer: PairScorer,
  random: SeededRandom,
  iterations: number,
): LocalSearchResult {
  if (groups.length < 2 || iterations <= 0) {
    return { swapsApplied: 0, iterations: 0, improvement: 0 };
  }

  const EPSILON = 1e-9;
  let swapsApplied = 0;
  let improvement = 0;

  for (let step = 0; step < iterations; step += 1) {
    const gA = random.nextInt(groups.length);
    let gB = random.nextInt(groups.length);
    if (gA === gB) gB = (gB + 1) % groups.length;

    const groupA = groups[gA] as number[];
    const groupB = groups[gB] as number[];
    const iA = random.nextInt(groupA.length);
    const iB = random.nextInt(groupB.length);
    const memberA = groupA[iA] as number;
    const memberB = groupB[iB] as number;

    let delta = 0;
    for (let i = 0; i < groupA.length; i += 1) {
      if (i === iA) continue;
      const other = groupA[i] as number;
      delta += scorer.score(memberB, other) - scorer.score(memberA, other);
    }
    for (let i = 0; i < groupB.length; i += 1) {
      if (i === iB) continue;
      const other = groupB[i] as number;
      delta += scorer.score(memberA, other) - scorer.score(memberB, other);
    }

    if (delta > EPSILON) {
      groupA[iA] = memberB;
      groupB[iB] = memberA;
      swapsApplied += 1;
      improvement += delta;
    }
  }

  return { swapsApplied, iterations, improvement };
}
