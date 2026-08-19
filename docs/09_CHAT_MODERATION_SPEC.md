# Chat Moderation Spec

## Chat Scope

- Group-only chat.
- No global chat.
- Text-only messages.
- Chat opens only after matching is complete and admin opens chat.
- Users can see group code/name, group members, and message history.

## Message Storage

Every message stores:

- event ID
- group ID
- sender participant ID
- raw text
- censored text
- moderation status
- timestamp

Chat history is retained for safety and future review needs.

## User Disclosure

The privacy policy must disclose:

- chat messages are stored
- reports may expose relevant chat context to admins
- moderation may censor abusive language

Avoid claiming that nobody will ever read chats. Safer wording: messages are not actively monitored except for safety, abuse reports, and operational needs.

## Profanity and Abuse Handling

MVP moderation uses a server-side dictionary.

Message pipeline:

1. Trim text.
2. Reject empty messages.
3. Enforce max length.
4. Check spam/rate limit.
5. Detect blocked terms.
6. Replace censored terms.
7. Store raw and censored text.
8. Broadcast censored text.

## Moderation Outcomes

### CLEAN

No terms detected.

### CENSORED

Term replaced with `****`, message still sent.

### FLAGGED

Severe term detected. Message may be sent censored, but report/admin flag is created.

### BLOCKED

Message is not sent. Use only for extreme terms or repeated abuse.

## Rate Limiting

Rate limiting should stop real spam without harming normal conversation.

Suggested MVP:

- soft burst: 8 messages per 10 seconds
- hard burst: 15 messages per 30 seconds
- repeated violations trigger temporary cooldown

Cooldown copy should be calm:

```text
Slow down for a few seconds.
```

## Message Reporting

Users can report:

- a specific message
- a group member

Report captures:

- reporter
- reported user if known
- message
- group
- reason
- context snapshot of nearby messages
- timestamp

## Admin Review

Admin report queue shows:

- report reason
- reported message
- censored/raw text if authorized
- nearby context
- involved users
- group details

Admin actions for MVP:

- mark reviewed
- mark false alarm

Future actions:

- mute user
- remove user from chat
- delete message

## Security Requirements

- Users can only send messages to their own group.
- Users can only read messages from their own group.
- Users cannot spoof sender ID.
- Message writes go through server validation.
- WebSocket broadcast is not trusted as persistence.

