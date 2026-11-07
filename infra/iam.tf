# IAM, least privilege (CLAUDE.md): every action is named; no "*" actions anywhere.
# The only "*" RESOURCE is ecr:GetAuthorizationToken, which AWS does not allow to be
# scoped to a resource (it returns a registry-wide login token).

locals {
  ecs_trust = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Only ECS tasks in THIS account may assume the roles (confused-deputy guard).
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  }
}

# 1. Execution role: used by ECS itself BEFORE the app starts, to pull the image,
#    fetch secrets into environment variables, and ship logs.
resource "aws_iam_role" "execution" {
  name               = "${var.project}-ecs-execution"
  assume_role_policy = jsonencode(local.ecs_trust)
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # not scopable, see above
  }
  statement {
    sid       = "PullRunnerImage"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
    resources = [aws_ecr_repository.runner.arn]
  }
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.runner.arn}:log-stream:*"]
  }
  statement {
    sid     = "ReadOnlyTheseSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [for s in aws_secretsmanager_secret.provider : s.arn],
      [aws_db_instance.main.master_user_secret[0].secret_arn],
    )
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# 2. Task role: what the APPLICATION may do while running: read and write its own
#    S3 bucket. Nothing else (model APIs are reached over the internet with API keys).
resource "aws_iam_role" "task" {
  name               = "${var.project}-ecs-task"
  assume_role_policy = jsonencode(local.ecs_trust)
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ListOwnBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.data.arn]
  }
  statement {
    sid       = "ReadWriteOwnObjects"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.data.arn}/*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# 3. Scheduler role: EventBridge Scheduler uses it to start the task, and must be able
#    to hand the two roles above to ECS (iam:PassRole), only to ECS.
resource "aws_iam_role" "scheduler" {
  name = "${var.project}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "RunOnlyTheRunnerTask"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.runner.arn]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }
  statement {
    sid       = "PassOnlyTheTaskRolesToEcs"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "scheduler"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

# 4. GitHub Actions via OIDC: no long-lived AWS keys in GitHub. GitHub signs a short-
#    lived token per workflow run; AWS trusts it only for this repo's main branch.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_deploy" {
  name = "${var.project}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # Exactly this repository, exactly the main branch: no forks, no PRs, no tags.
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/main"
        }
      }
    }]
  })
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # not scopable
  }
  statement {
    sid = "PushRunnerImageOnly"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.runner.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
