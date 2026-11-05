# PROGRESS.md — stage tracker, manual tasks and decision log

This file tracks the build of CV Trojan Tracker against `SPEC.md`. A box is ticked only when the item is done **and** verified. Owner = Achref (manual), Claude = assistant.

Legend: `[x]` done · `[ ]` to do · `[~]` in progress / partly done · **(OWNER)** = manual task only the owner can do · **(DECISION)** = needs an owner decision before work continues.

Last updated: 2026-11-05

---

## Overview

| Stage | Name                                           | Status                                             |
| ----- | ---------------------------------------------- | -------------------------------------------------- |
| 0     | Repo scaffold                                  | [~] Local done; CI not yet run on GitHub           |
| 1     | First end-to-end call (1 job, 1 profile)       | [x] Done 2026-11-05 (CLEAN 35, DATA/WHITE 45; n=1) |
| 2     | Full corpus, hiding methods, extractors        | [x] Done 2026-11-05 (owner visual check open)      |
| 3     | Database, idempotent trials, resume            | [x] Done 2026-11-05                                |
| 4     | All providers, zod validation, rate limits     | [ ] Not started                                    |
| 5     | Queue, budget guard, plan/run/status, stopping | [ ] Not started                                    |
| 6     | Python analysis + export                       | [ ] Not started                                    |
| 7     | Results web page                               | [ ] Not started                                    |
| 8     | AWS infrastructure (Terraform) + OIDC CI       | [ ] Not started                                    |
| 9     | First full run, publish, DOI, README           | [ ] Not started                                    |

Rules that apply to every stage (from `CLAUDE.md`): explain before code; smallest thing that runs first; predict before running; stop at the end of the stage with a summary, verification steps and 3–5 interview questions; wait for the owner's answers before starting the next stage. No paid API call without a EUR budget confirmed in that session.

---

## Pre-work (before Stage 0)

- [x] Read `CLAUDE.md` and `SPEC.md`; restate the project in plain words (done 2026-11-04)
- [x] Review the spec and list risks in section 3 and 4.5 (16 items, see "Spec review decisions" below)
- [x] **(OWNER)** Answer the 16 spec review proposals — all accepted 2026-11-05; `SPEC.md` updated to v1.1
- [x] `.env` created from `.env.example` with a random local Postgres password; Postgres volume recreated so it uses it (2026-11-05)
- [ ] **(OWNER)** Add API keys to `.env` when the stage needs them (Anthropic: Stage 1; OpenAI, Gemini, OpenRouter: Stage 4)

---

## Stage 0 — Repo scaffold

**Goal:** an empty but complete workspace where tests, lint and CI all run, so every later stage starts from a green baseline.

**Done when (SPEC):** `pnpm test` and CI green on an empty test.

### Build tasks

- [x] `package.json` (root): private, ES modules, pnpm pinned via `packageManager`, Node `>=24 <25` in `engines`; scripts `test`, `test:watch`, `lint`, `format`, `typecheck`
- [x] `pnpm-workspace.yaml`: workspaces `packages/*` and `apps/*`
- [x] `tsconfig.base.json`: strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, NodeNext modules, composite projects
- [x] `tsconfig.json`: solution file with project references (`tsc -b`)
- [x] `packages/shared`: first package with one trivial export and one test
- [x] `vitest.config.ts`: runs `packages/*/src/**/*.test.ts` and `apps/*/src/**/*.test.ts`; excludes `*.live.test.ts` (paid tests)
- [x] `eslint.config.js` (flat config, `typescript-eslint` strict, Prettier compatibility) + `.prettierrc.json` + `.prettierignore`
- [x] `docker-compose.yml`: Postgres 16 + Redis 7, localhost-only ports, healthchecks, named volumes, Redis `appendonly yes` + `noeviction`
- [x] `.github/workflows/ci.yml`: install (frozen lockfile), lint, typecheck, test; `permissions: contents: read`
- [x] `.gitignore` (ignores `.env*` except `.env.example`), `.gitattributes` (LF line endings), `.env.example`
- [x] `CLAUDE.md` and `SPEC.md` added to the repo
- [x] `PROGRESS.md` (this file)

### Verification

- [x] `pnpm install --frozen-lockfile` succeeds
- [x] `pnpm lint` passes (ESLint + Prettier)
- [x] `pnpm typecheck` passes
- [x] `pnpm test` — 1 test passed
- [x] `docker compose up -d --wait` — postgres and redis healthy; `select version()` → PostgreSQL 16.15; `redis-cli ping` → PONG
- [x] Branch `stage-0-scaffold` created and committed (2026-11-05)
- [ ] Branch pushed and PR opened — blocked: github.com not resolvable from this machine; `gh` token expired (`gh auth refresh -h github.com`)
- [ ] CI green on GitHub

### Manual tasks

- [x] **(OWNER)** Approve commit + push + PR for Stage 0 (approved 2026-11-05)
- [ ] **(OWNER)** Optional: enable branch protection on `main` requiring the CI check
- [ ] **(OWNER)** Answer the Stage 0 questions in `QUESTIONS.md` (at the end of the project)

### Interview questions (Stage 0)

Moved to `QUESTIONS.md`.

---

## Stage 1 — First end-to-end call

**Goal:** prove the whole idea works once, with the smallest possible pipeline: PDF → extracted text → model → score. No database.

**Done when (SPEC):** two scores printed; raw responses saved to a JSON file; no DB yet.

### Build tasks

- [x] One job description (junior backend engineer) in `battery/jobs/`
- [x] One hand-written synthetic profile (fixed data, no generator yet): `battery/fixtures/stage1-profile.yaml`, medium fit
- [x] `battery/names.yaml` with a first curated list of synthetic names
- [x] Render two PDFs with `pdf-lib`: `CLEAN` and `DATA/WHITE` (byte-for-byte deterministic)
- [x] Extract text with `pdfjs-dist`; hidden keywords survive in the `DATA/WHITE` text (verified, and invisible in a rendered image)
- [x] Screener prompt `battery/prompts/screener.v1.md` (versioned; excluded from Prettier so its bytes never change)
- [x] `ModelAdapter` interface in `packages/shared` (SPEC 4.2) + a fake adapter
- [x] Anthropic adapter (key read from `.env` only; SDK retries off; no refusal fallbacks)
- [x] `config/models.yaml` (`claude-opus-5-5`, `claude-haiku-5-5`) and `config/prices.yaml` (cited prices, ECB rate)
- [x] `pnpm ctt stage1 --model <key> [--confirm-budget <EUR>]`: prints both scores, writes raw responses to `data/stage1/responses-*.json`; refuses paid models without a sufficient budget
- [x] Unit tests: renderer produces a valid deterministic PDF; extraction + survival; fake adapter; output parsing; idempotency key; cost arithmetic (22 tests)
- [x] Opt-in live test `packages/providers/src/anthropic.live.test.ts` (`RUN_LIVE=1`)
- [x] Live run on `claude-opus-5-5`: CLEAN 35/reject, DATA-WHITE 45/reject; raw responses in `data/stage1/`; cost EUR 0.011 (worst case EUR 0.16). One call each, so the +10 is not evidence of an effect yet

### Manual tasks

- [x] **(OWNER)** Put `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` in `.env` (key rotated after the leak, see D-020)
- [x] Anthropic model chosen by Claude (owner delegated decisions): `claude-opus-5-5`
- [x] Price entered from the Anthropic pricing page, dated, with source
- [x] **(OWNER)** EUR 1 budget confirmed 2026-11-05
- [ ] **(OWNER)** Open both PDFs and confirm the hidden text is invisible
- [ ] **(OWNER)** Predict the two scores (in `QUESTIONS.md`, 1.P1)
- [ ] **(OWNER)** Answer the Stage 1 questions in `QUESTIONS.md` (end of project)

### Decisions needed

- [x] **(DECISION)** Proposal #15 (idempotency key includes `inputs_sha256`) — accepted

---

## Stage 2 — Full corpus, hiding methods, extractors

**Goal:** generate the whole CV battery and measure, for every hiding method and extractor, whether the hidden text reaches the model at all.

**Done when (SPEC):** survival table printed; each PDF visually verified by the owner; unit tests per hiding method.

### Build tasks

- [x] `packages/corpus`: seeded profile generator (mulberry32 PRNG seeded from sha256; same seed → same profile), fit bands by rule
- [x] 4 jobs with vocabulary and `required_years`: junior backend engineer, data analyst, marketing manager, nurse
- [x] Profiles per job: 36 (12 strong / 12 medium / 12 weak) (#1); names unique within a job
- [x] Conditions: `CLEAN`, `DATA`, `INSTR`, `VIS_DATA`, `HIDDEN_NEUTRAL`, `VIS_INSTR` (#7); texts in `battery/injections.yaml` and `battery/common.yaml`
- [x] Hiding methods: `WHITE`, `TINY` (0.5 pt), `OFFPAGE` (x = page width + 100), `RENDER3` (Tr 3), `OCG_OFF` (layer OFF in default view)
- [x] `packages/extract`: `pdfjs` and `poppler` extractors; poppler path in `config/extractors.yaml`, verified to be poppler (not xpdf), version recorded
- [x] Survival check per CV × extractor: is the hidden text present in the extracted text?
- [x] Hash of extracted text stored; 5,184 extractions ? 1,800 distinct model inputs (2.9x fewer calls)
- [x] CLI: `ctt generate` (2,592 PDFs, 12 s), `ctt extract` (72 s), `ctt survival`
- [x] Unit tests per hiding method: PDF opens; visible text equals CLEAN; survival per extractor as recorded; pixel comparison with CLEAN (poppler render)
- [x] Unit tests: generator determinism, band rules, unique names, one-page fit, neutral-text length (61 tests total)

### Manual tasks

- [ ] **(OWNER)** Visually verify the hiding-method PDFs: open `data/corpus/pdfs/junior-backend-engineer/junior-backend-engineer-weak-01/` (run `pnpm ctt generate` first). Automated pixel check already passed: WHITE, OFFPAGE, RENDER3, OCG_OFF render identical to CLEAN; TINY leaves a faint hairline
- [x] Poppler path confirmed automatically: `C:\ProgramData\chocolatey\bin\pdftotext.exe`, poppler 26.09.0 (xpdf is rejected by `findPoppler`)
- [ ] **(OWNER)** Review `battery/names.yaml` (synthetic names only, no real individuals)
- [ ] **(OWNER)** Predict the survival table (in `QUESTIONS.md`, 2.P1)
- [ ] **(OWNER)** Answer the Stage 2 questions in `QUESTIONS.md` (end of project)

### Decisions needed

- [x] **(DECISION)** Proposals #1 (profiles vs repeats), #4 (dedupe by extracted text), #6 (fit bands as primary), #7 (extra controls), #9 (extractor path/version) — accepted

---

## Stage 3 — Database, idempotent trials, resume after kill

**Goal:** every trial and every paid call is recorded in Postgres, and restarting after a crash never pays for a trial twice.

**Done when (SPEC):** killing a run mid-way and restarting creates zero duplicate `call` rows (test proves it).

### Build tasks

- [x] `packages/db`: numbered plain-SQL migrations + runner that stores each file's sha256 and refuses edited migrations; `pnpm ctt migrate`
- [x] Tables (SPEC 4.3): `model`, `job`, `profile`, `cv_document`, `extraction`, `experiment`, `run`, `trial`, `trial_input`, `call`, `budget_ledger` (`001_initial.sql`, with CHECK constraints)
- [x] `trial.idempotency_key UNIQUE`; key includes `inputs_sha256` (#15)
- [x] `call.status` claimed → completed/failed; partial unique indexes: one completed call per trial AND one in-flight claim per trial; orphaned claims kept in the ledger (#16)
- [x] Budget check + reservation inside the claim transaction with the run row locked (#10, done early: needed for safe concurrency)
- [x] Typed queries (`pg`, parameterised SQL); lock-ordering rule: ledger writers lock the run row first (fixed a real deadlock found by the two-worker test)
- [x] `packages/engine`: claim → call → settle executor; `runPending` with explicit orphan recovery
- [x] Test: real child process killed with SIGKILL mid-run → restart → every trial has exactly one completed call, zero duplicates, orphaned claims accounted (passes 5/5 runs)
- [x] Test: two concurrent workers on one run → API called exactly once per trial
- [x] Test: budget cap → stops starting calls, committed spend never exceeds the cap
- [x] Test: idempotency key stability (Stage 1 tests) and DB-level duplicate rejection, even with raw SQL
- [x] CI: Postgres 16 service so the database tests run in CI too

### Manual tasks

- [x] **(OWNER)** `.env` has `DATABASE_URL`; `docker compose up -d` running (verified: `pnpm ctt migrate` applied `001_initial.sql`)
- [ ] **(OWNER)** Predict what happens on restart (in `QUESTIONS.md`, 3.P1)
- [ ] **(OWNER)** Answer the Stage 3 questions in `QUESTIONS.md` (end of project)

### Decisions needed

- [x] **(DECISION)** Proposals #15 and #16 — accepted

---

## Stage 4 — All providers behind the adapter

**Goal:** the same trial runs on Anthropic, OpenAI, Google and OpenRouter through one interface, with validated outputs and polite rate limiting.

**Done when (SPEC):** one trial per provider succeeds in an integration test (skipped in CI without keys).

### Build tasks

- [ ] Adapters: Anthropic, OpenAI, Google (Gemini), OpenRouter
- [ ] zod schemas for score output and rank output
- [ ] Unparseable answers stored with `parsed = null` and counted, never retried silently, never dropped
- [ ] Retries with exponential backoff on 429/5xx only
- [ ] Per-provider concurrency limits from config
- [ ] Record returned model ID, temperature, max tokens, reasoning setting
- [ ] Live tests in `*.live.test.ts`, run only with `RUN_LIVE=1 pnpm test:live`

### Manual tasks

- [ ] **(OWNER)** Add `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` to `.env`
- [ ] **(OWNER)** Choose the 6 models + 1 open-weight model, with exact dated model IDs, in `config/models.yaml`
- [ ] **(OWNER)** Enter every model's price in `config/prices.yaml` (dated, with source), plus the USD→EUR rate (proposal #12)
- [ ] **(OWNER)** Confirm a EUR budget for the live integration test run
- [ ] **(OWNER)** Answer the Stage 4 questions in `QUESTIONS.md` (end of project)

---

## Stage 5 — Queue, budget guard, CLI run commands, sequential stopping

**Goal:** runs are queued, parallel, resumable and **cannot exceed the budget**; cells stop sampling when the result is precise enough.

**Done when (SPEC):** a small paid run (owner-approved cap ≤ EUR 5) completes and stops correctly at the cap in a test with a fake adapter.

### Build tasks

- [ ] BullMQ queue + workers (Redis)
- [ ] `config/budget.yaml`: per-run cap, monthly cap (EUR)
- [ ] `ctt plan`: number of calls + estimated cost (upper bound at the repeat cap, proposal #11)
- [ ] `ctt run --confirm-budget <EUR>`: refuses if below the estimate
- [ ] Cost reservation before each call, settled after (proposal #10)
- [ ] Effective cap = min(confirmed, per-run, monthly remaining) (proposal #13)
- [ ] `budget_ledger` written in the same transaction as the `call` row
- [ ] Sequential stopping: one repeat across all profiles per batch, min 3, cap 10, t-interval on per-profile differences (#1, #8)
- [ ] `ctt status --run <id>`
- [ ] Tests with the fake adapter: stops at cap; never exceeds cap with concurrency; budget arithmetic

### Manual tasks

- [ ] **(OWNER)** Set the caps in `config/budget.yaml`
- [ ] **(OWNER)** Approve the small paid run cap (≤ EUR 5)
- [ ] **(OWNER)** Predict the number of calls and the cost before `ctt plan`
- [ ] **(OWNER)** Answer the Stage 5 questions in `QUESTIONS.md` (end of project)

### Decisions needed

- [x] **(DECISION)** Proposals #8, #10, #11, #12, #13, #14 — accepted
- [ ] **(OWNER)** Target total EUR budget for the first full run (#14)

---

## Stage 6 — Analysis (Python) and export

**Goal:** turn raw calls into effect sizes with honest uncertainty, checked independently of the TypeScript engine.

**Done when (SPEC):** analysis reproduces known answers on a synthetic dataset with a planted effect.

### Build tasks

- [ ] `analysis/` project with `uv` (Python 3.12, pandas, NumPy, SciPy, matplotlib, pytest)
- [ ] `ctt export --experiment <name> --out data/` (CSV + JSON)
- [ ] Metrics: score lift, advance-rate lift, rank lift, top-3 rate (definitions per decided proposals #2, #5)
- [ ] Paired bootstrap (10,000 resamples, resampling profiles)
- [ ] A/A noise floor / minimum effect size (proposal #3)
- [ ] Benjamini–Hochberg at FDR 0.05 (family defined in prereg)
- [ ] Figures
- [ ] Planted-effect test: known lift of +8 → CI contains 8

### Manual tasks

- [ ] **(OWNER)** Predict CI width on the planted dataset before running
- [ ] **(OWNER)** Answer the Stage 6 questions in `QUESTIONS.md` (end of project)

### Decisions needed

- [x] **(DECISION)** Proposals #2, #3, #5, #6 — accepted

---

## Stage 7 — Results web page

**Goal:** a static page anyone can read: headline effect, per-model chart with CIs, survival table, methodology, dataset download.

**Done when (SPEC):** page builds statically from exported JSON.

### Build tasks

- [ ] `apps/web`: Next.js + Tailwind, static export, reads exported JSON only (no live DB)
- [ ] Headline numbers with CI and noise floor
- [ ] Per-model chart with CIs
- [ ] Method × extractor survival table
- [ ] Methodology page (prereg commit hash shown)
- [ ] Dataset download

### Manual tasks

- [ ] **(OWNER)** Review wording: effect sizes and detection guidance only, no injection kit (SPEC hard rule 6)
- [ ] **(OWNER)** Answer the Stage 7 questions in `QUESTIONS.md` (end of project)

---

## Stage 8 — AWS infrastructure

**Goal:** scheduled, reproducible runs in the cloud with least-privilege access and no long-lived CI secrets.

**Done when (SPEC):** `terraform plan` reviewed by owner; least-privilege IAM, no wildcard actions.

### Build tasks

- [ ] `infra/` Terraform: S3 (PDFs, exports), scheduled ECS task, RDS or small Postgres, Secrets Manager
- [ ] IAM: least privilege, no wildcard actions (walked through field by field)
- [ ] Dockerfile for the runner (walked through field by field)
- [ ] GitHub Actions with OIDC (no static AWS keys)
- [ ] `terraform plan` output produced for review

### Manual tasks

- [ ] **(OWNER)** AWS account / region choice; budget alarm in AWS
- [ ] **(OWNER)** Put provider keys in Secrets Manager
- [ ] **(OWNER)** Review `terraform plan`
- [ ] **(OWNER)** Run `terraform apply` (Claude never runs it)
- [ ] **(OWNER)** Answer the Stage 8 questions in `QUESTIONS.md` (end of project)

---

## Stage 9 — First full run and publication

**Goal:** the pre-registered run, a citable dataset and a public results page.

**Done when (SPEC):** results page live; dataset has a DOI.

### Build tasks

- [ ] `prereg.yaml` complete: metrics, precision targets, repeat caps, FDR level, effect definition, model list with exact IDs, pool construction
- [ ] First full run per `prereg.yaml`
- [ ] Export + analysis + figures
- [ ] README first screen (SPEC section 9)
- [ ] Results page deployed

### Manual tasks

- [ ] **(OWNER)** Review and commit `prereg.yaml` **before** the run (frozen after the first full run)
- [ ] **(OWNER)** Verify the arXiv IDs and citations in SPEC section 2
- [ ] **(OWNER)** Confirm the EUR budget for the full run
- [ ] **(OWNER)** Publish the dataset (e.g. Zenodo) and get the DOI
- [ ] **(OWNER)** Final review of the README and results page

---

## Decision log

Decisions already made, with the reason. Newest at the bottom.

| ID    | Date       | Decision                                                                                                                                                  | Reason                                                                                                                                        | By     |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-001 | 2026-11-04 | TypeScript pinned to `~6.0.3` (not 7.x)                                                                                                                   | `typescript-eslint` 8.72 supports TS `<6.1.0` only (checked peer dependencies)                                                                | Claude |
| D-002 | 2026-11-04 | No `.nvmrc`; Node version set by `engines` in `package.json` and `node-version: 24` in CI                                                                 | The local Git Bash fnm hook breaks on `.nvmrc`; `engines` already states the requirement                                                      | Claude |
| D-003 | 2026-11-04 | Use PowerShell (not Git Bash) for `pnpm` on the owner's machine                                                                                           | Git Bash fnm use-on-cd hook errors in this repo                                                                                               | Claude |
| D-004 | 2026-11-04 | Docker ports bound to `127.0.0.1`                                                                                                                         | Databases not reachable from the network, even with a local default password                                                                  | Claude |
| D-005 | 2026-11-04 | Redis `appendonly yes` + `maxmemory-policy noeviction`                                                                                                    | BullMQ jobs must survive restarts and must never be silently evicted                                                                          | Claude |
| D-006 | 2026-11-04 | Paid tests named `*.live.test.ts` and excluded from `pnpm test`                                                                                           | A normal test run can never cost money                                                                                                        | Claude |
| D-007 | 2026-11-04 | CI token `permissions: contents: read`                                                                                                                    | Least privilege                                                                                                                               | Claude |
| D-008 | 2026-11-04 | GitHub Actions pinned to current majors: checkout v7, setup-node v7, pnpm/action-setup v6                                                                 | Latest releases checked with `gh api`                                                                                                         | Claude |
| D-009 | 2026-11-05 | `PROGRESS.md` is the single tracker for stages, manual tasks and decisions                                                                                | Owner request                                                                                                                                 | Owner  |
| D-010 | 2026-11-05 | All 16 spec-review proposals accepted; `SPEC.md` → v1.1                                                                                                   | See "Spec review decisions"                                                                                                                   | Owner  |
| D-013 | 2026-11-05 | No build step: Node 24 runs `.ts` directly (type stripping); `tsc` only type-checks (`noEmit`)                                                            | Less tooling to explain and maintain; `erasableSyntaxOnly` keeps code strippable                                                              | Claude |
| D-014 | 2026-11-05 | Anthropic SDK `maxRetries: 0`; no refusal `fallbacks`                                                                                                     | SDK retries 408/409/connection errors that may already be billed; fallbacks would answer with a different model and corrupt per-model results | Claude |
| D-015 | 2026-11-05 | Provider JSON schema is minimal; ranges/lengths enforced by zod (`ScoreOutput`)                                                                           | Not every provider's structured-output mode supports min/max/maxLength; one validator for all providers                                       | Claude |
| D-016 | 2026-11-05 | A free model (both prices 0) needs no USD to EUR rate                                                                                                     | The fake adapter must run before any rate is entered; paid models still stop without one                                                      | Claude |
| D-017 | 2026-11-05 | Anthropic models: `claude-opus-5-5` (thinking cannot be disabled, effort `low`, recorded) and `claude-haiku-5-5` (thinking disabled); temperature omitted | SPEC 3.9 two sizes; docs say omit sampling params; owner delegated decisions                                                                  | Claude |
| D-018 | 2026-11-05 | Prices from Anthropic pricing page; USD to EUR = 0.8875 from ECB 2026-11-04; tiered prices capped with `max_prompt_tokens`                                | Cited sources, never guessed; under-pricing long prompts would break the budget guard                                                         | Claude |
| D-019 | 2026-11-05 | Session budget EUR 1 confirmed for live calls                                                                                                             | Owner                                                                                                                                         | Owner  |
| D-020 | 2026-11-05 | Leaked key: owner revoked it; local unpushed history rewritten so no commit contains it; secret scanner added as pre-commit hook and in `pnpm lint` (CI)  | The key was in `.env.example` and Claude committed it with `git add -A`; it never reached GitHub                                              | Claude |
| D-021 | 2026-11-05 | Injected text always placed at the end of the CV, same position for every condition                                                                       | Conditions differ only in content and hiding method, not position                                                                             | Claude |
| D-022 | 2026-11-05 | TINY = 0.5 pt; OFFPAGE = x at page width + 100 pt; OCG layer named 'Notes', OFF in default view                                                           | Concrete values for SPEC 3.3                                                                                                                  | Claude |
| D-023 | 2026-11-05 | HIDDEN_NEUTRAL text: neutral sentences cut to at most the DATA text length (within 20 chars)                                                              | Length-matched control (#7)                                                                                                                   | Claude |
| D-024 | 2026-11-05 | Measured extractor behaviour is locked in tests (`EXPECTED_SURVIVAL`)                                                                                     | An extractor upgrade that changes what models see must fail CI and be reviewed                                                                | Claude |
| D-025 | 2026-11-05 | Generated profiles and PDFs are not committed; they are reproducible from seeds (determinism tested)                                                      | Avoids 2,592 binary files in git                                                                                                              | Claude |
| D-026 | 2026-11-05 | Database driver `pg` with hand-written parameterised SQL; own 40-line migration runner with checksums                                                     | Plain SQL migrations (CLAUDE.md); constraints stay visible; an ORM would hide them                                                            | Claude |
| D-027 | 2026-11-05 | Second partial unique index: at most one `claimed` call per trial                                                                                         | Stops two concurrent workers from calling the API for the same trial                                                                          | Claude |
| D-028 | 2026-11-05 | Every ledger-writing transaction locks the run row first (`lockRun`)                                                                                      | Fixes a deadlock between claim and completion found by the two-worker test                                                                    | Claude |
| D-029 | 2026-11-05 | HTTP error responses release the reservation (not billed); errors without a status (dropped connection) keep it as possibly paid                          | Conservative: an unknown outcome is counted as spent                                                                                          | Claude |
| D-030 | 2026-11-05 | Orphan recovery is an explicit step, only when no worker for the run is alive                                                                             | Recovering while another worker is mid-call would mark its live claim as orphaned                                                             | Claude |
| D-012 | 2026-11-05 | Interview questions and predictions collected in `QUESTIONS.md`; build continues without waiting for answers                                              | Owner request; `CLAUDE.md` rule 5 updated                                                                                                     | Owner  |
| D-011 | 2026-11-05 | Idempotency key uses extracted-text hashes (not extraction IDs)                                                                                           | Same text → same key, which implements deduplication (#4) for free                                                                            | Claude |

---

## Spec review decisions

All 16 proposals were accepted by the owner on 2026-11-05 and written into `SPEC.md` v1.1 (the section numbers below refer to it). Status: Proposed / Accepted / Rejected / Modified.

Concrete values chosen when applying them (owner can override before `prereg.yaml` is frozen): 36 profiles per job (12/12/12); sequential stopping in batches of one repeat across all profiles, minimum 3, cap 10; minimum effect size of interest 3 score points; "advance" = would invite to a first interview.

Still open: the **target total EUR budget** for the first full run (#14), set by the owner in `prereg.yaml`.

| #   | Area      | Problem                                                                                                                                                 | Proposal                                                                                                        | Status   |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | 3.1 / 3.7 | CI width is set by between-profile variance; more repeats cannot shrink it, so cells run to the 50 cap. 12 clusters is too few for a reliable bootstrap | 30–40 profiles per job, 3–5 repeats; average repeats within profile, then pair by profile                       | Accepted |
| 2   | 3.6       | "Same repeat index" pairing is meaningless (calls are independent)                                                                                      | Remove it from the score-lift definition; pair by profile                                                       | Accepted |
| 3   | 3.6 / 3.8 | A/A noise floor overlaps with the CI and shrinks to zero with more data                                                                                 | Keep A/A as a sanity check; define "effect" as CI excludes 0 **and** ≥ a pre-registered minimum (e.g. 3 points) | Accepted |
| 4   | 3.3 / 3.4 | With extracted text, several hiding methods likely give identical model input → paying up to 5× for the same experiment                                 | Hash extracted text, call models once per distinct text; method effect = survival × text effect                 | Accepted |
| 5   | 3.5 / 3.6 | Rank-task pools and "comparable pools" are undefined                                                                                                    | Define in prereg: same pool ± injection of candidate X; which X (weak/medium); which 5 in the 5-of-10 pool      | Accepted |
| 6   | 3.1 / 3.5 | Ceiling effect for strong candidates; "advance" not defined                                                                                             | Report by fit band, medium/weak primary; prompt defines "advance"                                               | Accepted |
| 7   | 3.2       | No length-matched neutral hidden-text control; no visible-instruction control                                                                           | Optional: add `HIDDEN_NEUTRAL` and `VIS_INSTR`                                                                  | Accepted |
| 8   | 3.7       | Sequential stopping runs in TypeScript but the bootstrap is in Python                                                                                   | Engine stops on a pre-registered t-interval of per-profile differences; Python bootstrap for reporting          | Accepted |
| 9   | 3.4       | Two `pdftotext` on the machine: Git's is xpdf 4.00, not poppler                                                                                         | Configure the absolute path; record extractor name + version in `extraction`                                    | Accepted |
| 10  | 4.5       | "In-flight calls finish" can overshoot the cap by concurrency × max call cost                                                                           | Reserve worst-case cost before each call, settle after                                                          | Accepted |
| 11  | 4.5       | Output tokens, reasoning tokens and stopping make the call count/cost uncertain                                                                         | `ctt plan` shows an upper bound (repeat cap, `max_tokens`) plus a typical estimate                              | Accepted |
| 12  | 4.5       | Providers price in USD; caps are in EUR                                                                                                                 | Human-entered, dated USD→EUR rate in `prices.yaml`; cached-input/batch prices if used                           | Accepted |
| 13  | 4.5       | Interaction of `--confirm-budget`, per-run cap and monthly cap undefined                                                                                | Effective cap = min of the three; month in UTC                                                                  | Accepted |
| 14  | 3 / 4.5   | Full design ≈ 403,000 score calls at the cap before rank tasks and A/A                                                                                  | Reduce via #1 and #4; agree a target total budget                                                               | Accepted |
| 15  | 4.4       | Idempotency key omits the CV/condition/method/extractor → CLEAN and DATA trials collide                                                                 | Add a hash of the ordered trial inputs (extracted-text hashes) to the key                                       | Accepted |
| 16  | 4.4       | UNIQUE row ≠ no double spend: a crash after the API answers but before the insert pays twice on resume                                                  | Write a "claimed" row before each call; claimed-without-result counts as possibly paid                          | Accepted |

---

## Findings so far

- **F-1 (Stage 2, 2026-11-05):** For text-based screeners, WHITE and RENDER3 produce exactly the same extracted text as the visible version (VIS_DATA / VIS_INSTR): the model cannot tell hidden from visible. OFFPAGE text never reaches the model (0/144 for both extractors). OCG_OFF reaches the model through pdf.js (144/144) but not poppler (0/144). TINY reaches both, with different line breaks.

## Budget ledger (paid calls)

| Date       | What                                                               | Model           | Calls | Cost EUR | Session budget left |
| ---------- | ------------------------------------------------------------------ | --------------- | ----- | -------- | ------------------- |
| 2026-11-05 | Stage 1 first try (HTTP 400, workspace header missing; not billed) | claude-opus-5-5 | 2     | 0        | 1.000               |
| 2026-11-05 | Stage 1 live run                                                   | claude-opus-5-5 | 2     | 0.011    | 0.989               |

## Environment notes (owner's machine)

- Node 24.22, pnpm 12.16.1, Docker 26.1.4 / Compose 2.27, uv 0.13.7, Python 3.12.4
- `pdftotext`: `C:\Program Files\Git\mingw64\bin\pdftotext.exe` = xpdf 4.00; `C:\ProgramData\chocolatey\bin\pdftotext.exe` = poppler 26.09.0
- Run `pnpm` from PowerShell (see D-003)
