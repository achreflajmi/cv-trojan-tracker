output "ecr_repository_url" {
  description = "Push the runner image here (the deploy workflow does it)."
  value       = aws_ecr_repository.runner.repository_url
}

output "github_deploy_role_arn" {
  description = "Set as the GitHub repository variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}

output "data_bucket" {
  description = "S3 bucket for PDFs and dataset exports."
  value       = aws_s3_bucket.data.bucket
}

output "provider_secret_names" {
  description = "Put the API keys into these secrets (values never go through Terraform)."
  value       = [for s in aws_secretsmanager_secret.provider : s.name]
}

output "db_endpoint" {
  description = "Private RDS endpoint (reachable only from the runner)."
  value       = aws_db_instance.main.address
}
