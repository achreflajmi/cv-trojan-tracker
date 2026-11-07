# S3: generated PDFs and dataset exports. Private, encrypted, versioned, TLS only.
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "data" {
  # Account ID in the name: bucket names are global, this keeps it unique.
  bucket = "${var.project}-data-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    object_ownership = "BucketOwnerEnforced" # ACLs disabled; IAM policies decide access
  }
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled" # a published dataset version can never be silently overwritten
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # S3-managed keys: encrypted at rest, no KMS cost
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90 # keep overwritten versions 90 days, then delete (cost)
    }
  }
}

# Deny any request that is not over TLS.
data "aws_iam_policy_document" "data_tls_only" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"]
    resources = [
      aws_s3_bucket.data.arn,
      "${aws_s3_bucket.data.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.data_tls_only.json
}

# ECR: the runner image. Tags are immutable, so a tag always means the same image.
resource "aws_ecr_repository" "runner" {
  name                 = "${var.project}-runner"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true # basic vulnerability scan of every pushed image
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "runner" {
  repository = aws_ecr_repository.runner.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images (cost)"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# Secrets Manager: one secret per provider key. Terraform creates the containers only;
# the owner puts the values in (console or `aws secretsmanager put-secret-value`), so
# no key ever appears in code, state or plan output.
resource "aws_secretsmanager_secret" "provider" {
  for_each                = var.provider_secret_names
  name                    = "${var.project}/${each.value}"
  recovery_window_in_days = 7
}

# CloudWatch logs for the runner; 30 days is enough to debug a monthly run.
resource "aws_cloudwatch_log_group" "runner" {
  name              = "/ecs/${var.project}-runner"
  retention_in_days = 30
}
