# Matching Decisions

This file intentionally holds unresolved matching decisions. The matching algorithm will be handled separately and may be built with Claude, but the product and engineering contract must be clear first.

## Decisions To Make Later

### Matching Philosophy

Should groups be based on:

- similar interests
- complementary styles
- department/course diversity
- random stranger mixing with light compatibility
- hybrid scoring

### Group Size

Options:

- fixed 4
- fixed 5
- flexible 4 to 6

For 1000 users, flexible sizes may reduce unmatched users.

### Missing Answers

Policy options:

- allow matching with up to 1 missing answer
- allow matching with up to 2 missing answers
- treat missing answer as neutral
- reduce confidence score for missing answers
- exclude users after too many missed answers

User preference so far: missing one or two answers should still be recorded and may still be used.

### Late Joiners

Policy options:

- allow users who joined through question 1
- allow users who joined through question 2
- exclude later users from matching
- create overflow/manual groups for late users

### Department/Course Influence

Decide whether to:

- mix departments intentionally
- match similar departments
- ignore department/course for matching
- use department/course only as tie-breaker

### User Explanation

Should users see:

- no explanation
- fun group reason
- shared interests
- answer similarity summary

### Admin Controls

Should admin be able to:

- rerun matching
- manually move users
- lock matching permanently once chat opens

Recommended MVP: allow rerun only before chat opens. No manual moving initially.

## Non-Negotiable Engineering Requirements

- Algorithm must be deterministic for same event input and seed.
- Algorithm must return every matchable participant at most once.
- Algorithm must not include removed users.
- Algorithm must produce an audit object.
- Algorithm must finish fast enough for a live event.
- Algorithm must tolerate missing answers according to final policy.
- Algorithm must be isolated behind the contract in `08_MATCHING_ENGINE_CONTRACT.md`.

### Matching Policy Risk: Missed Answers

The current MVP algorithm excludes participants with more than 2 missed answers. This may create many unmatched students under weak network conditions. Before event day, the product team must decide whether heavily incomplete participants should be randomly grouped, grouped with lower confidence, or left unmatched.

### Flexible Group Overflow

The current algorithm may use `allowOversizeGroups = true` in flexible mode to absorb leftovers into existing groups. Validators and persistence code must respect `audit.policy.effectiveMaxSize` rather than assuming the requested max size is the final max size.
