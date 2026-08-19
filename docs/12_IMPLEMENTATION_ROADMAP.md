# Implementation Roadmap

## Stage 0: Project Setup

Deliverables:

- Next.js app scaffold
- TypeScript
- Tailwind
- lint/format setup
- environment variable template
- docs linked from README

Exit criteria:

- app runs locally
- empty home page renders

## Stage 1: Supabase Foundation

Deliverables:

- Supabase project setup
- schema migrations
- RLS baseline
- Google OAuth config
- server/browser Supabase clients

Exit criteria:

- user can authenticate locally
- profile can be read/written safely

## Stage 2: Student Onboarding

Deliverables:

- event-first home page
- Google continue
- department/course form
- participant creation
- lobby route

Exit criteria:

- student can join event and resume after refresh

## Stage 3: Admin Foundation

Deliverables:

- `/admin` route
- Google admin login
- allowed email check
- dashboard shell
- event state controls

Exit criteria:

- only allowed admin can access dashboard
- admin can open lobby/start event state

## Stage 4: Cloudflare Realtime Foundation

Deliverables:

- Cloudflare Worker
- Durable Object event room
- signed realtime token flow
- client websocket hook
- polling fallback

Exit criteria:

- admin state change reaches connected student clients
- fallback polling works when websocket disabled

## Stage 5: Questions and Timers

Deliverables:

- question builder
- question options
- countdown state
- active question state
- pause/resume/extend/lock
- student question UI

Exit criteria:

- full question lifecycle works from admin to student

## Stage 6: Responses

Deliverables:

- answer upsert endpoint
- edit-before-lock behavior
- lock missing answers as `MISSED`
- response progress counts

Exit criteria:

- students can answer/change until lock
- locked question rejects changes

## Stage 7: Metrics

Deliverables:

- metric generator
- metric snapshot persistence
- metric publish action
- student metric screen

Exit criteria:

- each locked question can publish a playful metric

## Stage 8: Matching Contract

Deliverables:

- matching input builder
- matching output validator
- placeholder deterministic algorithm
- persistence transaction/RPC
- matching audit storage

Exit criteria:

- groups can be generated and stored with placeholder logic

## Stage 9: Final Matching Algorithm

Deliverables:

- algorithm implementation
- missing answer policy
- group size policy
- deterministic seed support
- load tests with synthetic data

Exit criteria:

- 1000 participant matching completes within target

## Stage 10: Group Chat

Deliverables:

- group chat UI
- group member display
- icebreaker prompt
- message persistence
- group chat Durable Object
- websocket fan-out
- chat polling fallback

Exit criteria:

- users can chat only with assigned group

## Stage 11: Moderation and Reports

Deliverables:

- moderation terms
- censor pipeline
- spam rate limit
- report message/member
- admin report queue

Exit criteria:

- abusive words are censored
- reports reach admin with context

## Stage 12: Scale and Rehearsal

Deliverables:

- load test scripts
- 1000-user simulation
- weak-network testing
- event runbook
- rollback plan

Exit criteria:

- rehearsal completes with acceptable performance
- known limits are documented

## Stage 13: Production Event Prep

Deliverables:

- Vercel deployment
- Cloudflare Worker deployment
- Supabase production env
- admin email configured
- final questions loaded
- privacy policy published

Exit criteria:

- event-day checklist signed off

