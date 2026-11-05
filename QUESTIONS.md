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
