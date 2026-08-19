# UI/UX Spec

## Product Feel

Event-first, clean, energetic, and professional.

Branding should be balanced:

- enough Appirates identity to feel official
- not overdesigned
- no heavy marketing homepage
- the work and interaction should speak

## Student Home

Purpose: get students into the event quickly.

Content:

- event title
- short one-line induction context
- Google continue button
- lightweight trust/privacy note

No admin link on home page.

## Profile Details Screen

Fields:

- name from Google, read-only or lightly editable only if later approved
- department
- course

No phone, roll number, profile editing, or extra details in MVP.

## Lobby

Goals:

- keep students engaged while waiting
- show that the room is filling up
- work under weak networks

Elements:

- joined count
- department distribution
- animated but lightweight waiting visual
- reaction buttons/counters
- connection status if needed

Avoid:

- heavy canvas animations
- large images
- noisy UI

## Question Screen

Elements:

- question number
- remaining time
- question text
- answer options
- selected answer state
- ability to change before lock

Behavior:

- answers feel instant using optimistic UI
- server confirmation still required
- if timer locks, options become disabled

## Metric Screen

Elements:

- playful title
- one strong metric line
- simple visual distribution or score
- next-state waiting cue

Tone:

- curious
- funny
- neutral
- not judgemental

## Matching Screen

Purpose: hold attention while server forms groups.

Elements:

- short animated status
- no fake progress if progress is unknown
- copy like "Finding signal in the chaos"

## Group Chat Screen

Elements:

- group name/code
- member names
- icebreaker prompt
- message list
- text input
- report action on message/member

No global chat.

## Admin UI

Admin dashboard should be dense and operational.

Priorities:

- current state is obvious
- next action is obvious
- timer controls are reliable
- live counts are visible
- dangerous actions require confirmation

Avoid:

- decorative landing-page style
- nested cards
- oversized hero layouts
- hidden controls

## Responsive Requirements

Student:

- optimized for mobile first
- usable on 360px width
- buttons large enough for thumb use
- text must not overflow

Admin:

- optimized for laptop/desktop
- usable on tablet if needed

## Accessibility

- sufficient contrast
- clear focus states
- no color-only status
- buttons have loading/disabled states
- timers have text labels
- motion should be lightweight

