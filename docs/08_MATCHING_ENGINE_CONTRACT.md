# Matching Engine Contract

The matching algorithm must be isolated so it can be implemented or replaced independently.

## Module Boundary

Recommended path:

```text
src/server/matching/
```

Main function:

```ts
runMatching(input: MatchingInput): Promise<MatchingOutput>
validateMatchingOutput(output: MatchingOutput): Result<MatchingOutput>
```

## Input

```ts
export interface MatchingInput {
  eventId: string;
  seed: string;
  groupSizePolicy: GroupSizePolicy;
  participants: MatchingParticipant[];
  questions: MatchingQuestion[];
  responses: MatchingResponse[];
  options: MatchingOption[];
}

export interface GroupSizePolicy {
  mode: "fixed" | "flexible";
  fixedSize?: number;
  minSize?: number;
  maxSize?: number;
}

export interface MatchingParticipant {
  participantId: string;
  profileId: string;
  fullName: string;
  department: string;
  course: string;
  joinedAt: string;
  status: "JOINED" | "ACTIVE" | "LATE" | "MATCHABLE";
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
```

## Output

```ts
export interface MatchingOutput {
  success: boolean;
  groups: MatchingGroup[];
  unmatched: MatchingUnmatched[];
  audit: MatchingAudit;
  error?: string;
}

export interface MatchingGroup {
  temporaryId: string;
  code: string;
  name: string;
  icebreakerPrompt: string;
  memberParticipantIds: string[];
  score?: number;
  explanation?: string;
}

export interface MatchingUnmatched {
  participantId: string;
  reason:
    | "too_many_missing_answers"
    | "late_join"
    | "overflow"
    | "removed"
    | "algorithm_error";
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
```

## Persistence Rule

The matching function does not write to the database directly.

Flow:

1. Server fetches input from Supabase.
2. Server calls `runMatching`.
3. Server validates output.
4. Server persists groups and group members inside one transaction/RPC.
5. Server stores audit JSON.

## Validation Rules

Before persistence:

- no duplicate participant IDs across groups
- no unknown participant IDs
- group sizes match policy (must respect `audit.policy.effectiveMaxSize` when `allowOversizeGroups` is true)
- matched + unmatched equals input matchable participants
- every group has code and name
- no empty group

## Determinism

The function must use only the provided `seed` for randomness.

Same input + same seed = same output.

## Performance Target

Initial target:

- 1000 participants
- 5 to 10 questions
- complete in less than 5 seconds on Vercel server runtime

If algorithm needs longer, move matching to a background job or Supabase Edge Function later.

