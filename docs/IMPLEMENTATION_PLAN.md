# Implementation Plan — pointer

The canonical, cross-repo implementation plan lives in the web repo so there is one source of truth:

**`money-log-web/docs/IMPLEMENTATION_PLAN.md`**

It covers backend work in detail:

- §1 Transaction edit & delete endpoints
- §2 Recurring transactions engine (occurrence materialization, generator job, auto-post, catch-up)
- §3 Reporting/series endpoints needed to replace frontend mock data
- §4 Reminders & notifications rework (queue schema, scheduling, retries, templates, Expo receipts)
- §5 Validation, error handling and rate limiting coverage
- §6 Tenancy rules (user-scoped data)
- §7 File upload conventions ahead of an S3/GCS move

Plaid-specific outstanding work stays in `docs/TASKS.md`.
Database conventions stay in `docs/DATABASE_GUIDELINES.md`.
