# CLAUDE.md — working rules for this repository

## Project

CV Trojan Tracker: measures whether hidden text in CVs changes how AI models score and rank candidates, repeated on every new model version. The full build plan is in `SPEC.md`. Read it before any work. Follow its stages in order.

## How to work with me

I am the owner and I must be able to defend every line in a technical interview. So:

1. **Explain before code.** Before introducing anything new (a library, BullMQ, bootstrap statistics, Terraform, IAM), explain in plain words what problem it solves and what the alternatives are. Then write code.
2. **Smallest thing that runs first.** Show it, explain every non-obvious line, then let me extend it when the stage says so.
3. **Config field by field.** The first time we write Terraform, IAM policies, GitHub Actions YAML or a Dockerfile, walk through every field. Least privilege, never wildcard IAM actions.
4. **Predict before running.** Before any significant run, ask me what I expect, then show me where I was wrong.
5. **Stop at the end of each stage.** Summarise what was built, show how to verify it, and ask me 3–5 interview-style questions about it. Wait for my answers before starting the next stage.
6. **Call out mistakes directly**, including statistical reasoning errors and cargo-culting.
7. **When something breaks**, say how you would have diagnosed it from the symptom.
8. State file names explicitly whenever you create or change files.

## Hard rules (never break these)

- Never make a paid model API call unless I have confirmed a EUR budget for it in this session. Use the fake adapter for development and tests.
- Never send generated CVs anywhere except model APIs listed in `config/models.yaml`. Never to real employers, job boards or screening products.
- Never commit secrets. Keys only in `.env` (git-ignored). If a key appears in code or a log, stop and tell me.
- Never edit `prereg.yaml` after the first full run.
- Never hard-code model IDs or prices; they live in `config/`.
- Never invent prices. If `config/prices.yaml` lacks a model, stop and ask me.
- Never run `terraform apply` yourself. Produce the plan; I apply.

## Commands

- `pnpm install` — install
- `pnpm test` — unit tests (no network)
- `RUN_LIVE=1 pnpm test:live` — live provider tests (costs money; only with my budget confirmation)
- `pnpm lint`
- `docker compose up -d` — Postgres 16 + Redis 7
- `pnpm ctt <command>` — the CLI (see SPEC.md section 5)
- `cd analysis && uv run pytest` — analysis tests

## Conventions

- TypeScript strict, ES modules, Node 24 (LTS).
- zod at every boundary (config files, model outputs, CLI input).
- SQL migrations are plain SQL files, numbered, never edited after merge.
- Idempotency is enforced by database constraints, not only by code.
- Small commits with clear messages; one stage per pull request.
- `PROGRESS.md` is the tracker: tick an item only when it is done and verified, record every decision in the decision log, and list every manual task for the owner.
