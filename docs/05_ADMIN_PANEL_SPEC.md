# Admin Panel Spec

## Route

Initial route: `/admin`.

This route is not linked from the student home page.

## Authentication

- Admin logs in with Google.
- Email must exist in `admin_users` and `is_active = true`.
- Only one super admin role is required for MVP.

## Dashboard Sections

### Header

Shows:

- event name
- current state
- active question number
- websocket health
- polling fallback status

### Event Controls

Actions:

- open lobby
- close joining
- start countdown
- start question
- pause timer
- resume timer
- extend timer
- lock current question
- publish metric
- next question
- run matching
- open group chat
- end event

All state transitions must be server-validated.

### Question Builder

Admin can:

- create question
- edit question body
- set answer options
- set timer seconds
- reorder questions
- activate/deactivate question

MVP supports text-only questions and text-only options.

### Live Metrics

Admin sees:

- total joined
- active/online estimate
- responses for current question
- missed current question
- department distribution
- course distribution
- reaction counts
- current websocket connection estimate
- fallback polling users estimate, if available

### Question Runtime Panel

Shows:

- current question text
- options
- remaining timer
- answer count
- lock state
- metric draft after lock

### Matching Panel

Shows:

- total participants
- participants with complete responses
- participants with missing responses
- matchable count
- unmatched count
- matching status
- matching error details
- generated group count

Actions:

- run matching
- rerun matching before chat opens, if allowed by final policy
- open group chat after matching succeeds

### Chat Reports Panel

Shows:

- open reports
- reporter
- reported message
- reported user
- group
- surrounding context snapshot
- timestamp

Actions:

- mark reviewed
- mark false alarm
- optionally mute user later

No live full-chat surveillance screen is required for MVP. Reports expose only necessary context.

## Admin Safety Rules

- Timer state lives on server.
- Admin UI cannot be trusted as source of truth.
- Every admin action writes to Supabase first.
- Realtime broadcast follows persistence, not the other way around.
- Dangerous actions should use confirmation dialogs:
  - end event
  - rerun matching
  - open group chat

## MVP Exclusions

- Multi-admin roles.
- Audit logs.
- Manual group editing.
- Force matching overrides.
- Live projector control.
- Rich media question editor.

