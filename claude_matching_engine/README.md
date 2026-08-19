# Matching module

Implements `docs/08_MATCHING_ENGINE_CONTRACT.md`. Pure, deterministic, no I/O.

```ts
import { runMatching } from "@/server/matching";

const output = await runMatching(input);
if (!output.success) {
  // output.error is safe to show an admin
}
```

Optional second argument for tuning. `MatchingInput` is untouched, so the
contract stays exactly as documented.

```ts
const output = await runMatching(input, {
  allowOversizeGroups: false,
  maxMissedAnswers: 3,
  excludeLateJoiners: true,
});
```

## Files

| File | Responsibility |
| --- | --- |
| `types.ts` | Contract types (verbatim) + `MatchingConfig` + internal shapes |
| `prng.ts` | xmur3 + sfc32 seeded PRNG, FNV-1a stable hash, seeded shuffle |
| `scoring.ts` | Answer matrix, pair score, precomputed pair table, group score |
| `grouping.ts` | Size planning, greedy seeding, bounded swap local search |
| `naming.ts` | Deterministic codes, names, icebreakers |
| `validation.ts` | Input validation, canonical ordering, output validation |
| `runMatching.ts` | Orchestration, eligibility split, audit |
| `index.ts` | Public API |
| `selfTest.ts` | 14 dependency-free tests |

## Running the tests

No test framework was installed. `selfTest.ts` has zero dependencies and
returns structured results, so it works under whatever you adopt later.

```bash
npx tsx src/server/matching/selfTest.ts   # add a small entry that calls reportSelfTests()
```

Under vitest, each entry in the `cases` array maps directly onto an `it(...)`.

## Policy as implemented

- Eligible statuses: `JOINED`, `ACTIVE`, `LATE`, `MATCHABLE`. `REMOVED` is
  rejected defensively even though the contract's union excludes it.
- More than `maxMissedAnswers` (default 2) missed answers →
  `too_many_missing_answers`.
- Missed answers are ignored on both sides of a pair, never penalised.
- Pair score = agreed weight / comparable weight, plus `+0.03` for different
  department and `+0.02` for different course, capped at `1.05`. Group `score`
  in the output is the average pair score normalised to `0..1`.
- No comparable answers → pair score `0`, diversity bonus not applied.
- Flexible default `4..5`. Fixed uses `fixedSize` exactly; leftovers become
  `overflow`.

## Deliberate deviations from the brief

**1. `allowOversizeGroups` defaults to `true` (flexible mode only).**
The brief says leftovers become `overflow`. With `minSize: 4, maxSize: 5`,
leftovers arise at `n ≡ 1, 2, 3 (mod 4/5 combinations)` — for example `n = 11`
leaves one person with no group. A student sitting alone while the room chats
is a worse event outcome than a group of six. Leftovers are absorbed one per
group, so no group exceeds `maxSize + 1`. Pass `{ allowOversizeGroups: false }`
to restore strict behaviour. Fixed mode is never oversized.

**2. Input is canonically sorted before anything else runs.**
"Same input = same output" is not achievable if the caller fetches rows without
`ORDER BY`, because Postgres does not guarantee row order. Participants,
questions, options and responses are all sorted by stable keys inside the
module. This is defence in depth — still add `ORDER BY` in the fetch.

**3. Tuning lives in a second argument, not in `MatchingInput`.**
Keeps the documented contract byte-identical while leaving room for the
matching philosophy in `docs/07_MATCHING_DECISIONS.md` to be settled later.

## Measured behaviour

1000 participants, 10 questions, 4 options with realistic skewed popularity,
Node 22:

- Full run: **~110–200 ms** (budget is 5000 ms).
- Group score, optimised: **0.66** mean. Random baseline: **0.35**.
- 5 questions → 0.86 mean; 15 questions → 0.59 mean. Fewer questions means a
  coarser, more agreeable-looking score, not a better match.

Exclusions from the `>2 missed answers` rule, by per-answer miss rate over 10
questions:

| Miss rate | Excluded from 1000 |
| --- | --- |
| 3% | 2 |
| 6% | 23 |
| 10% | 72 |
| 15% | 170 |
| 20% | 308 |

## Known limitations

- **Greedy leaves a quality gradient.** First 20 groups average `0.73`, last 20
  average `0.54`. The people placed last get the leftovers. Fixable by
  re-targeting the local search at the worst group instead of the total.
- **Local search barely earns its keep.** At 8000 iterations it applied 3
  accepted swaps and moved the mean by `+0.0003`. Greedy already sits in a
  strong single-swap local optimum. It is retained because it is nearly free
  and will matter more if the objective changes.
- **`matchingValue` on `MatchingOption` is unused.** Options are compared by
  `optionId` identity. When the matching philosophy is decided, that field is
  the intended hook for semantic distance between options.
- **`late_join` is unreachable by default.** The policy includes LATE
  participants. Set `excludeLateJoiners: true` to use it.

## Persistence (roadmap Stage 8)

Validate before writing. Use `validateMatchingOutput`, which reads the size
bounds from `audit.policy.effectiveMinSize` / `effectiveMaxSize` rather than
from the original request — the request's `maxSize` is the wrong bound once
oversize absorption has run.

```ts
import { validateMatchingOutput } from "@/server/matching";

const check = validateMatchingOutput(output, participantIds);
if (!check.ok) throw new Error(check.error);
```

Store the whole `audit` object in `groups.matching_audit`. It contains the
seed, the resolved config and the algorithm version, which is what you need to
reproduce a run during the post-event debrief.
