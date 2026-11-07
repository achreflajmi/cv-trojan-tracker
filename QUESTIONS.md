# QUESTIONS.md — interview questions and predictions to answer

The owner decided (2026-11-05) to build all stages first and answer these at the end. Each stage appends its questions here. Write your answer under each question; tick it when answered.

Prediction prompts are kept too. Answering them after the fact is less useful, so for those, write what you _would_ have predicted and then compare with the recorded result.

---

## Stage 0 — Repo scaffold

### Interview questions

- [ ] **0.1** Why does `.gitignore` list `.env` and `.env.*` and then `!.env.example`? Which leak does each line prevent?
- [ ] **0.2** What does `pnpm install --frozen-lockfile` protect against in CI, and what happens without it?
- [ ] **0.3** Redis is configured with `maxmemory-policy noeviction`. What would go wrong for a job queue under an eviction policy when memory fills up?
- [ ] **0.4** `noUncheckedIndexedAccess` changes the type of `arr[0]`. How, and why does it matter more in this project than in a typical web app?
- [ ] **0.5** Why bind the Docker ports to `127.0.0.1` when the password is only for local use?
- [ ] **0.6** Postgres reads `POSTGRES_PASSWORD` only when its data volume is first created. What symptom do you get if you change the password in `.env` afterwards, and how do you fix it?

### Predictions

- [ ] **0.P1** Will CI pass on its first run on GitHub? If not, which step fails?

---

## Stage 1 — First end-to-end call

### Interview questions

- [ ] **1.1** Why does the CV renderer fix the PDF creation/modification dates? What would break later if it did not?
- [ ] **1.2** The Anthropic adapter sets `maxRetries: 0`. Which SDK retries could cost money twice, and why?
- [ ] **1.3** Why are refusal fallbacks (re-running a refused request on another model) wrong for this project, even though they are good practice in a product?
- [ ] **1.4** The JSON schema sent to the provider has no `minimum`/`maximum`, but zod enforces 0–100. Why validate twice, and why is a failed validation stored as `parsed = null` instead of throwing?
- [ ] **1.5** The worst-case input cost uses the prompt's UTF-8 byte length as the token count. Why is that a safe upper bound, and when is it very pessimistic?
- [ ] **1.6** Why is the prompt file excluded from Prettier?

### Predictions

- [ ] **1.P1** Before the first live run: what score will the model give the CLEAN CV and the DATA/WHITE CV (0–100), and will either be "advance"?
- [ ] **1.P2** Will the hidden white text survive pdf.js extraction? (Recorded result: yes, all 10 keywords, as the last line of the extracted text.)

### Added after the first live call

- [ ] **1.7** The first live call failed with HTTP 400 about a workspace header. How do you know from the status code alone that it was not billed, and why should a client never retry a 400?
- [ ] **1.8** CLEAN scored 35 and DATA/WHITE 45. Why is this single pair not evidence that the injection works? What would you need?
- [ ] **1.9** An API key ended up in a committed template file. List every place it could still exist after removing it from the file, and how each was handled.

---

## Stage 2 — Full corpus, hiding methods, extractors

### Interview questions

- [ ] **2.1** Why is the profile generator seeded with a string hashed by sha256 and a hand-written PRNG, instead of `Math.random()`?
- [ ] **2.2** WHITE and RENDER3 give exactly the same extracted text as VIS_DATA. What does that imply for interpreting "the effect of hiding" in a text-based pipeline, and what would change in v2 (sending the PDF itself)?
- [ ] **2.3** Why does OCG_OFF survive pdf.js but not poppler? Which one behaves like a "real" screening pipeline, and how would you find out?
- [ ] **2.4** Why is HIDDEN_NEUTRAL length-matched to DATA, and what confound does it remove?
- [ ] **2.5** The hiding-method tests lock in the measured extractor behaviour. Why is a test that fails after a library upgrade useful here rather than annoying?
- [ ] **2.6** How does the pixel comparison prove invisibility, and what are its limits (renderer, resolution, viewer settings)?

### Predictions

- [ ] **2.P1** Before seeing the table: which hiding methods survive pdf.js, and which survive poppler? (Recorded: see PROGRESS.md finding F-1.)

---

## Stage 3 — Database, idempotent trials, resume after kill

### Interview questions

- [ ] **3.1** A `UNIQUE` constraint on the trial key does not by itself stop paying twice. Why not, and what does the claim → call → settle protocol add?
- [ ] **3.2** Why are there two partial unique indexes on `call` (completed, and claimed)? What goes wrong with only the first one when two workers run?
- [ ] **3.3** Explain the deadlock the two-worker test found, step by step, and why "lock the run row first" fixes it. What is the cost of that fix?
- [ ] **3.4** Why is the budget check inside the same transaction as the claim, with `SELECT ... FOR UPDATE`? What would happen with a check in application code before the transaction?
- [ ] **3.5** After a SIGKILL during an API call, the reservation stays in the ledger as "orphaned". Why is that the right default, and when could it overstate spend?
- [ ] **3.6** The migration runner stores a checksum per file. What does that protect against, and why normalise line endings before hashing?
- [ ] **3.7** Why does the kill test use a real child process and SIGKILL instead of throwing an exception inside the same process?

### Predictions

- [ ] **3.P1** Before the kill test: after SIGKILL and restart, how many `call` rows will have status `failed`, and why is the answer "0 or 1"?

---

## Stage 4 — All providers behind the adapter

### Interview questions

- [ ] **4.1** Why are 429 and 5xx retried but a dropped connection is not, even though a dropped connection is the most "transient" failure of all?
- [ ] **4.2** What is "full jitter" backoff and what problem does it solve when many workers hit a rate limit at the same moment?
- [ ] **4.3** Why does the retry give up when `retry-after` is longer than the configured ceiling, instead of waiting?
- [ ] **4.4** On OpenRouter, why pin a single upstream endpoint and turn fallbacks off? What would the data look like if you did not?
- [ ] **4.5** Three of the chosen models cannot turn reasoning off. How does that affect comparing models, and how is it handled in the data?
- [ ] **4.6** Why does a price carry `valid_until`, and what goes wrong if an expired lower price is used?

### Predictions

- [ ] **4.P1** Before the first live call per provider: which provider's answer is most likely to be unparseable or refused, and why?

---

## Stage 5 — Queue, budget guard, plan/run/status, sequential stopping

### Interview questions

- [ ] **5.1** BullMQ and the database both "know" which trials are done. Which one is the source of truth, and why can a duplicated queue job never pay twice?
- [ ] **5.2** Why does BullMQ get `attempts: 1`, when retrying failed jobs is normally the point of a queue?
- [ ] **5.3** The stopping rule uses a t-interval; the reported CI uses a paired bootstrap. Why two methods, and is stopping on precision (not on the effect) a form of p-hacking?
- [ ] **5.4** Why must CLEAN keep sampling while any cell that uses it is still sampling, even if CLEAN's own cells have stopped?
- [ ] **5.5** The OFFPAGE cell stops after the minimum repeats with a lift of exactly 0 and a zero-width interval. Why is that correct, and why is it not a "measured" zero?
- [ ] **5.6** Explain the circuit breaker: what failure mode did the resume test expose, and why does a failed run stay resumable?
- [ ] **5.7** `plan` shows an upper bound of EUR 47.80 but a typical cost of EUR 2.39 for Opus. Where does the 20x gap come from, and which number should `--confirm-budget` cover?

### Predictions

- [ ] **5.P1** Before `ctt plan` for the pilot: how many distinct model inputs would you expect from 24 profiles, and why fewer than 24 × (1 CLEAN + 8 variants + 1 A/A)? (Recorded: 120.)

---

## Stage 6 — Analysis and export

### Interview questions

- [ ] **6.1** Why resample profiles and not individual calls? What would happen to the CI width if you resampled calls?
- [ ] **6.2** Why stratify the bootstrap by job?
- [ ] **6.3** What exactly does the BH correction control, and why is the family "all primary-band score lifts" rather than one family per model?
- [ ] **6.4** The 1-point lift test has a CI that excludes zero but is not reported as an effect. Defend that rule to a reviewer who says "but it is significant".
- [ ] **6.5** Why is the analysis in Python, separate from the TypeScript engine, and why does it read only the exported CSV?
- [ ] **6.6** One call fans out to several variants in `calls.csv`. Does that inflate the evidence for the cells that share it? Why or why not?

### Predictions

- [ ] **6.P1** For the planted dataset (108 profiles, 72 in the primary bands, 3 repeats, call noise SD 6): roughly how wide will the 95% CI of the lift be?

---

## Rank task (SPEC 3.5)

### Interview questions

- [ ] **R.1** Why must every injected pool have a matched clean pool with the same ten profiles? What would a comparison across different pools confound?
- [ ] **R.2** Why is the candidate order shuffled per repeat, and why are the candidate IDs assigned by position (C1..C10) rather than by profile?
- [ ] **R.3** Why is the target drawn from the medium/weak bands?
- [ ] **R.4** A rank test failed with one seed. How did you decide whether it was a bug or bad luck, and what did the 30-seed check show?
- [ ] **R.5** Why is the bootstrap anti-conservative with 24 clusters, and what are two ways to fix it?

### Predictions

- [ ] **R.P1** In a 5-of-10 pool, will the target gain more or fewer places than in a 1-of-10 pool? Why (Baxi et al.)?

---

## Stage 7 — Results page

### Interview questions

- [ ] **7.1** Why a static export instead of a server reading the database? What does that buy for reproducibility, cost and security?
- [ ] **7.2** The build once picked up fake-model results and presented them without a banner. How was it caught, and why is the guard in both the analysis and the page?
- [ ] **7.3** How does the chart avoid relying on color alone or on hover alone?
- [ ] **7.4** Why does the headline show the noise floor and the date next to the number?
- [ ] **7.5** Tailwind 4.3.5 was released the same day. Why pin 4.3.3 instead of adding a release-age exception?

---

## Stage 8 — AWS infrastructure

### Interview questions

- [ ] **8.1** Explain the difference between the ECS execution role and the task role. What would go wrong if you merged them?
- [ ] **8.2** The GitHub OIDC trust policy pins `sub` to `repo:<owner>/<repo>:ref:refs/heads/main`. What attack does that stop, and what if you only checked `aud`?
- [ ] **8.3** Why is `ecr:GetAuthorizationToken` the only statement with `Resource: "*"`, and why is that still "least privilege"?
- [ ] **8.4** No NAT gateway: how does the runner reach the APIs, and why is it still not reachable from the internet?
- [ ] **8.5** Why is the RDS password managed by RDS instead of a `random_password` resource in Terraform?
- [ ] **8.6** The Docker smoke test found two bugs that unit tests never could. What were they, and why did development hide them?
- [ ] **8.7** The schedule is created disabled and never retries. Which hard rule does that protect?

### Predictions

- [ ] **8.P1** Before `terraform plan`: how many resources will it create? (Count the `resource` blocks, including `count`/`for_each`.)
