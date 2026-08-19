# Question and Metrics Spec

## Question Requirements

- Questions are created from the admin panel.
- Questions are shown in the student app only.
- Each question has a fixed timer.
- Users can change their answer until timer lock.
- No answer is correct or wrong.
- Missing answers are recorded.

## Default Timing

Initial defaults:

- Pre-question countdown: 5 seconds.
- Question answer window: 45 seconds.

Admin can change timer per question and extend during runtime.

## Question Data

Each question has:

- position
- body
- option list
- timer duration
- optional metric labels per option
- optional matching metadata per option

## Answer Locking

Before lock:

- user can create answer
- user can update answer

After lock:

- user cannot answer or edit
- unanswered users get a `MISSED` response row
- metric can be computed

## Metric Goals

Metrics should:

- keep users engaged
- feel playful and curious
- avoid shaming any answer
- avoid speed-based ranking
- avoid implying correct/wrong choices
- be shown on phones only

User requested tone: playful and possibly brutal, but not insulting or discriminatory.

## Metric Types

### Room Split

Shows distribution without ranking people.

Example:

```text
The room did not agree. 38% went tactical, 29% went chaotic, 21% played safe, 12% chose the wildcard.
```

### Chaos Meter

Uses answer distribution entropy.

Example:

```text
Chaos Meter: 82/100. This batch is not easy to predict.
```

### Rare Signal

Highlights minority choices without making them wrong.

Example:

```text
Only 9% picked the riskiest route. Small squad, loud signal.
```

### Consensus Pulse

Shows whether the room is aligned or divided.

Example:

```text
Consensus Pulse: scattered. Everyone saw a different game here.
```

### Department Drift

Compares department-level distribution if sample size is large enough.

Example:

```text
CSE leaned experimental. ECE leaned tactical. Civil refused to be predictable.
```

Privacy rule: only show department comparisons when each displayed bucket has enough responses.

### Mirror Line

Generates a one-line roast-style observation.

Example:

```text
This room says "teamwork" but 41% just chose the solo save.
```

## Metric Generation Inputs

- question
- option labels
- counts per option
- percentage per option
- total answered
- total missed
- department distribution, optional
- course distribution, optional

## Metric Publishing

Metrics are not streamed continuously by default.

Flow:

1. Timer locks.
2. Server computes metric snapshot.
3. Admin previews or auto-publishes depending on setting.
4. Published metric is stored in `question_metrics`.
5. Realtime bus broadcasts metric ID/payload.
6. Clients display metric.

## Metric Safety

Do not generate metrics based on:

- individual identity
- gender or sensitive attributes
- who answered fastest
- who missed a question
- any label that sounds like psychological diagnosis

