# Terraform and provider versions. Pinning avoids a silent behaviour change between
# `plan` (reviewed by the owner) and `apply` (run by the owner).
terraform {
  required_version = ">= 1.10.0" # 1.10+ for S3 native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72" # allows 6.72.x and later 6.x, never 7.x (breaking changes)
    }
  }

  # Remote state, recommended before the first apply: state can contain resource
  # identifiers and must not live only on one laptop. The bucket is created by hand
  # once (chicken-and-egg). Left commented so `terraform plan` works without it.
  # backend "s3" {
  #   bucket       = "<your-state-bucket>"
  #   key          = "cv-trojan-tracker/terraform.tfstate"
  #   region       = "eu-central-1"
  #   encrypt      = true
  #   use_lockfile = true # S3 native locking, no DynamoDB table needed
  # }
}

provider "aws" {
  region = var.region

  # Every resource gets these tags: who owns it and that Terraform manages it.
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Repo      = var.github_repository
    }
  }
}
