# Appirates Crew Match Documentation Index

Working product name: Appirates Crew Match.

This documentation set defines the rebuild plan for the Appirates induction event web app. The product is event-first today, while preserving a clean user/data foundation for a possible future Appirates platform.

## Locked Architecture

- Frontend and app backend: Next.js on Vercel.
- Auth and primary database: Supabase Auth and Supabase Postgres.
- Realtime layer: Cloudflare Workers plus Durable Objects using WebSockets.
- Realtime fallback: HTTP polling through Next.js API routes.
- Matching engine: isolated server module with a strict input/output contract.
- Admin model: one super admin, Google login, allowed email list.

## Documents

1. [Product Requirements](./01_PRODUCT_REQUIREMENTS.md)
2. [User Flows](./02_USER_FLOWS.md)
3. [System Architecture](./03_SYSTEM_ARCHITECTURE.md)
4. [Database Schema](./04_DATABASE_SCHEMA.md)
5. [Admin Panel Spec](./05_ADMIN_PANEL_SPEC.md)
6. [Question and Metrics Spec](./06_QUESTION_AND_METRICS_SPEC.md)
7. [Matching Decisions](./07_MATCHING_DECISIONS.md)
8. [Matching Engine Contract](./08_MATCHING_ENGINE_CONTRACT.md)
9. [Chat Moderation Spec](./09_CHAT_MODERATION_SPEC.md)
10. [Realtime and Scale Plan](./10_REALTIME_AND_SCALE_PLAN.md)
11. [UI/UX Spec](./11_UI_UX_SPEC.md)
12. [Implementation Roadmap](./12_IMPLEMENTATION_ROADMAP.md)

## Open Decisions

- Final product name.
- Final branding direction.
- Exact department/course lists.
- Question count and final question content.
- Matching strategy and scoring logic.
- Event-day infrastructure budget if free limits are exceeded.

