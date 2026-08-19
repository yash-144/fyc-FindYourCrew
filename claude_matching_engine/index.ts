/**
 * Public API for the matching module.
 *
 * Consumers should import from here only. Everything else is an implementation
 * detail and may change without notice.
 *
 *   import { runMatching } from "@/server/matching";
 *   const output = await runMatching(input);
 *   if (!output.success) { /* show output.error to admin *\/ }
 */

export { runMatching, resolveConfig, DEFAULT_MATCHING_CONFIG } from "./runMatching";
export { validateOutput, validateMatchingOutput } from "./validation";

export type {
  GroupPlan,
  GroupSizePolicy,
  MatchingAudit,
  MatchingConfig,
  MatchingConfigOverrides,
  MatchingGroup,
  MatchingInput,
  MatchingOption,
  MatchingOutput,
  MatchingParticipant,
  MatchingQuestion,
  MatchingResponse,
  MatchingUnmatched,
  ParticipantStatus,
  UnmatchedReason,
} from "./types";
