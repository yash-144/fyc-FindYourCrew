# Product Requirements

## Product Summary

Appirates Crew Match is a live induction event web app for first-year students. Students join with Google, enter minimal profile details, answer timed questions, see playful post-question metrics, and are matched into private stranger groups with text chat.

The event is controlled live from the stage by a single super admin.

## Goals

- Make induction interactive instead of passive.
- Keep onboarding simple: Google login plus department and course.
- Support around 700 to 1000 simultaneous participants.
- Keep the student app usable on weak college Wi-Fi and mobile data.
- Create groups of strangers after the quiz so students can start interacting.
- Store participant and event data in a future-friendly structure.
- Keep the initial build focused on the induction event, not a full club platform.

## Non-Goals

- No full Appirates club portal in this phase.
- No native mobile app.
- No global public chat.
- No physical meetup or check-in flow.
- No profile editing after registration in the first release.
- No multi-admin role hierarchy in the first release.
- No complex admin audit log in the first release.
- No college email-domain restriction.

## Primary Users

### Student

First-year student attending induction. Uses phone browser.

Student needs:

- Fast login.
- Minimal form entry.
- Reliable quiz flow.
- Clear timer and answer state.
- Ability to change answer before time ends.
- Engaging feedback after each question.
- Group chat after matching.

### Super Admin

Event host/operator. Uses laptop browser.

Admin needs:

- Restricted Google login.
- Create/edit questions.
- Start and control the event.
- Pause/resume/extend timers.
- Publish metrics.
- Run matching.
- Open group chats.
- Monitor live counts and reports.

## User Data Collected

From Google:

- Full name.
- Email.
- Google user ID / Supabase auth ID.
- Avatar may be stored if later approved, but is not required for MVP.

Entered by user:

- Department.
- Course.

Stored during event:

- Join status.
- Question responses, including missing responses.
- Group assignment.
- Chat messages.
- Reports.

## Event Assumptions

- Only one live induction event runs at a time.
- Event lasts about one hour.
- Users can join during the lobby and possibly during the first one or two questions.
- Late users may still be included in matching depending on matching policy.
- Missing one or two answers should be recorded and may still be usable for matching.
- All answers are neutral. There are no correct or wrong answers.

## Core Student Flow

1. Visit `/`.
2. Continue with Google.
3. Confirm/enter profile details.
4. Enter waiting lobby.
5. Watch live participant count and lightweight lobby interactions.
6. When admin starts, see a short pre-question countdown.
7. Read question, choose answer, and optionally change it before timer ends.
8. After timer ends, see a playful metric.
9. Repeat for all questions.
10. Wait during matching.
11. Enter assigned group chat.
12. See group code/name, member names, and icebreaker prompt.
13. Chat with group members.

## Core Admin Flow

1. Visit restricted admin route.
2. Continue with Google.
3. Admin email is checked against allowlist.
4. Prepare questions.
5. Open lobby.
6. Start event.
7. Control each question timer.
8. Publish post-question metric.
9. Run matching after final question.
10. Open group chats.
11. Monitor reported messages.
12. End event.

## Functional Requirements

- Google OAuth for all users.
- One active event state machine.
- Department/course capture.
- Dynamic lobby participant count.
- Optional lightweight reactions.
- Admin-created questions and options.
- Pre-question countdown.
- Server-owned question timer.
- Editable answer before timer lock.
- Missing answer tracking.
- Post-question metric generation.
- Matching engine invocation.
- Group creation.
- Group-only text chat.
- Profanity/abuse censoring.
- Message reporting.
- Admin report review.
- Polling fallback if WebSocket fails.

## Non-Functional Requirements

- Target peak: 700 to 1000 simultaneous students.
- Target state update delay: about 1 second when WebSocket is healthy.
- Chat delivery target: about 1 second when WebSocket is healthy.
- Weak-network support through retry, reconnection, and fallback polling.
- Server-side validation for all critical writes.
- Minimal client payload sizes.
- Idempotent answer submission/update logic.
- Data retained in Supabase for future review and future platform use.

## Privacy Position

The privacy policy must clearly state:

- Basic profile and event responses are stored.
- Group chat messages are retained for safety.
- Reports may make relevant chat context visible to admins/mods.
- The app is not a personality test and does not assign permanent labels.

