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
