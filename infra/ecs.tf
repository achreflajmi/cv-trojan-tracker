# The scheduled runner: one Fargate task = migrate + one experiment run for one model.
# Redis runs as a sidecar in the same task: the queue only needs to live for one run,
# because the database is the source of truth (Stage 3), so no ElastiCache cost.

resource "aws_ecs_cluster" "main" {
  name = var.project
  setting {
    name  = "containerInsights"
    value = "disabled" # extra metrics cost money; logs are enough for a monthly job
  }
}

locals {
  secret_env = concat(
    [for name in var.provider_secret_names : { name = name, valueFrom = aws_secretsmanager_secret.provider[name].arn }],
    [
      # Single JSON fields of the RDS-managed secret ("<arn>:<json-key>::").
      { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
    ],
  )
}

resource "aws_ecs_task_definition" "runner" {
  family                   = "${var.project}-runner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc" # required by Fargate: the task gets its own network interface
  cpu                      = "512"    # 0.5 vCPU
  memory                   = "1024"   # 1 GB: Node + pdf.js + Redis sidecar
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # Graviton: cheaper per vCPU; the image is built for arm64
  }

  container_definitions = jsonencode([
    {
      name      = "redis"
      image     = "public.ecr.aws/docker/library/redis:7-alpine" # ECR Public mirror: no Docker Hub rate limits
      essential = false
      command   = ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory-policy", "noeviction"]
      healthCheck = {
        command  = ["CMD", "redis-cli", "ping"]
        interval = 5
        timeout  = 3
        retries  = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options   = { awslogs-group = aws_cloudwatch_log_group.runner.name, awslogs-region = var.region, awslogs-stream-prefix = "redis" }
      }
    },
    {
      name      = "runner"
      image     = "${aws_ecr_repository.runner.repository_url}:${var.image_tag}"
      essential = true
      dependsOn = [{ containerName = "redis", condition = "HEALTHY" }]
      # Containers in one task share localhost.
      environment = [
        { name = "REDIS_URL", value = "redis://localhost:6379" },
        { name = "PGHOST", value = aws_db_instance.main.address },
        { name = "PGDATABASE", value = aws_db_instance.main.db_name },
        { name = "EXPERIMENT", value = var.experiment },
        { name = "MODEL_KEY", value = var.model_key },
        { name = "CONFIRM_BUDGET_EUR", value = tostring(var.confirm_budget_eur) },
      ]
      secrets = local.secret_env
      command = ["sh", "-c", "node apps/cli/src/main.ts migrate && node apps/cli/src/main.ts run --experiment \"$EXPERIMENT\" --model \"$MODEL_KEY\" --confirm-budget \"$CONFIRM_BUDGET_EUR\""]
      logConfiguration = {
        logDriver = "awslogs"
        options   = { awslogs-group = aws_cloudwatch_log_group.runner.name, awslogs-region = var.region, awslogs-stream-prefix = "runner" }
      }
    },
  ])
}

# EventBridge Scheduler starts the task on the schedule. Created DISABLED: a paid run
# starts only after the owner sets schedule_enabled = true (budget confirmation).
resource "aws_scheduler_schedule" "monthly" {
  name                         = "${var.project}-monthly-run"
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = "UTC"
  state                        = var.schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.runner.arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.runner.id]
        assign_public_ip = true # outbound internet without a NAT gateway; inbound is blocked by the SG
      }
    }

    retry_policy {
      maximum_retry_attempts = 0 # never start a second paid run automatically
    }
  }
}
