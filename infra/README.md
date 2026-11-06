# infra/ — AWS for scheduled runs (Stage 8)

Claude writes and validates this code; **the owner runs `plan` and `apply`** (CLAUDE.md).

## What it creates

| Piece                                                                   | Why                                                                      | Rough monthly cost (eu-central-1, check the AWS pricing pages) |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| VPC, 2 public + 2 private subnets, internet gateway                     | network; **no NAT gateway** (saves ~USD 35)                              | 0                                                              |
| RDS PostgreSQL 16, db.t4g.micro, 20 GB gp3, private                     | the measurements                                                         | ~USD 13–16 (the main fixed cost)                               |
| ECS cluster + Fargate task (0.5 vCPU, 1 GB, ARM64) with a Redis sidecar | the runner; only billed while a run is going                             | cents per run                                                  |
| EventBridge Scheduler (monthly, **created disabled**)                   | starts the run                                                           | 0                                                              |
| S3 bucket (private, versioned, TLS only)                                | PDFs and exports                                                         | cents                                                          |
| ECR repository (immutable tags, scan on push)                           | runner image                                                             | cents                                                          |
| Secrets Manager: 5 provider-key secrets + 1 RDS-managed                 | API keys and DB password, never in code or state                         | ~USD 2.40 (USD 0.40 per secret)                                |
| CloudWatch log group (30 days)                                          | logs                                                                     | cents                                                          |
| IAM: execution, task, scheduler and GitHub OIDC roles                   | least privilege; `node scripts/check-iam.mjs` proves no wildcard actions | 0                                                              |

Model API costs come on top and are capped by `confirm_budget_eur` and `config/budget.yaml`.
To pay nothing while the project is idle: `terraform destroy` (RDS keeps a final snapshot) or stop the RDS instance.

## Owner steps

1. **AWS account + CLI login** (`aws configure sso` or `aws configure`), region `eu-central-1`. Set a **budget alarm** in AWS Billing first.
2. **Plan** (read every line):
   ```bash
   cd infra
   terraform init
   terraform plan -out=ctt.tfplan
   ```
3. **Apply** (owner only): `terraform apply ctt.tfplan`.
4. **Put the API keys into Secrets Manager** (names from `terraform output provider_secret_names`):
   ```bash
   aws secretsmanager put-secret-value --secret-id ctt/ANTHROPIC_API_KEY --secret-string 'sk-ant-...'
   ```
   Secrets you do not use can stay empty, but ECS refuses to start a task whose secret
   has **no value at all**: put a placeholder such as `unused` into those.
5. **GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):
   `AWS_DEPLOY_ROLE_ARN` = `terraform output -raw github_deploy_role_arn`, `AWS_REGION` = `eu-central-1`.
   The deploy workflow then pushes the runner image on every merge to `main`.
6. **Roll out an image**: set `image_tag` to the pushed commit SHA (`-var image_tag=<sha>` or a `terraform.tfvars`), `terraform apply`.
7. **Enable paid runs** only when you have confirmed a budget: `-var schedule_enabled=true -var confirm_budget_eur=<EUR>`, `terraform apply`.
   The run still refuses to start if the budget is below `ctt plan`'s upper bound.
8. **Load the corpus** into RDS once: generate + extract locally, then run `ctt ingest` against RDS (for example as a one-off ECS task with the command overridden), because the database is private.

## Checks

- `terraform fmt -check -recursive && terraform validate` (CI job `infra`)
- `node scripts/check-iam.mjs` (CI): fails on any wildcard IAM action
