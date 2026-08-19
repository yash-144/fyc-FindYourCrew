# User Flows

## Global Event States

The application is controlled by one active event state.

```text
SETUP
LOBBY
COUNTDOWN
QUESTION_ACTIVE
QUESTION_LOCKED
METRIC_REVEAL
MATCHING
GROUP_CHAT_OPEN
ENDED
```

For implementation, question number is stored separately from state.

## Student Flow

```text
Visit Home
  -> Google Login
  -> Profile Details
  -> Lobby
  -> Countdown
  -> Question
  -> Answer/Edit Answer
  -> Locked
  -> Metric
  -> Next Countdown/Question
  -> Matching Wait
  -> Group Chat
```

## Student Reconnect Flow

If the student refreshes, switches network, or disconnects:

1. Client reloads authenticated user.
2. Client fetches current event state.
3. Client fetches participant record.
4. Client fetches latest response for active question.
5. Client resumes the correct screen.

Expected outcomes:

- During lobby: return to lobby.
- During active question: show remaining time and current selected answer.
- During locked/metric phase: show locked/metric screen.
- During matching: show wait screen.
- During group chat: open assigned group chat.

## Late Join Flow

Late join policy must be configurable.

Initial default:

- LOBBY: user joins normally.
- COUNTDOWN/QUESTION 1: user may join and answer current question.
- QUESTION 2: user may join if admin setting allows late join.
- QUESTION 3 onward: user joins as observer/standby and is not guaranteed matching.

The system records missed questions as explicit missing responses, not as silent absence.

## Question Flow

```text
Admin starts countdown
  -> Student sees 3-5 second countdown
  -> Admin/system opens question
  -> Student selects option
  -> Student can change option until timer ends
  -> Timer ends
  -> Server locks question
  -> Metric is calculated
  -> Student sees metric
```

## Metric Flow

Metrics are shown on phones only.

```text
Question locked
  -> Server computes response snapshot
  -> Server generates playful metric
  -> Metric is published
  -> Clients display metric until admin advances
```

## Group Chat Flow

```text
Matching complete
  -> Group records created
  -> User receives group code/name
  -> User sees members
  -> Icebreaker prompt shown
  -> Chat opens
  -> Messages are censored and stored
  -> Users can report messages
```

## Report Flow

```text
User reports message/member
  -> Report row created
  -> Context snapshot attached
  -> Admin report queue updates
  -> Admin reviews report
```

## Admin Flow

```text
Admin route
  -> Google login
  -> Email allowlist check
  -> Dashboard
  -> Prepare questions
  -> Open lobby
  -> Start event
  -> Control timers
  -> Publish metrics
  -> Run matching
  -> Open chat
  -> Review reports
  -> End event
```

## Admin Timer Controls

Admin can:

- Start countdown.
- Start question timer.
- Pause timer.
- Resume timer.
- Extend timer.
- Lock question immediately.
- Republish current state after connection issues.

## Failure Flows

### WebSocket Fails

Client switches to polling:

- Event state: every 3 to 5 seconds.
- Chat: every 2 to 4 seconds.
- Lobby count: every 5 seconds.

### Answer Submit Fails

Client retries once. If still failing, it shows a clear retry action while timer remains active.

### Matching Fails

Admin sees error. Chat stays closed. Participants remain on matching wait screen.

