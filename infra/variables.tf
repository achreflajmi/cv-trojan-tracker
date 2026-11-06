variable "region" {
  description = "AWS region. eu-central-1 (Frankfurt) keeps data in the EU."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "ctt"
}

variable "github_repository" {
  description = "owner/repo allowed to push images through GitHub OIDC."
  type        = string
  default     = "achreflajmi/cv-trojan-tracker"
}

variable "image_tag" {
  description = "Runner image tag (the git commit SHA pushed by the deploy workflow)."
  type        = string
  default     = "latest-main"
}

variable "schedule_expression" {
  description = "When the measurement runs. Default: 03:00 UTC on the 1st of every month."
  type        = string
  default     = "cron(0 3 1 * ? *)"
}

variable "schedule_enabled" {
  description = "The schedule is created DISABLED: paid runs start only when the owner flips this."
  type        = bool
  default     = false
}

variable "experiment" {
  description = "Experiment name in config/experiments/ that the scheduled task runs."
  type        = string
  default     = "full"
}

variable "model_key" {
  description = "Model key in config/models.yaml for the scheduled run (one run per model)."
  type        = string
  default     = "claude-haiku-5-5"
}

variable "confirm_budget_eur" {
  description = <<-EOT
    EUR the owner confirms for each scheduled run (passed as --confirm-budget). The run
    refuses to start if this is below `ctt plan`'s upper bound, and config/budget.yaml
    caps still apply. Setting this is the owner's budget confirmation for scheduled runs.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.confirm_budget_eur > 0 && var.confirm_budget_eur <= 50
    error_message = "confirm_budget_eur must be between 0 and 50 EUR; raise the limit here deliberately."
  }
}

variable "provider_secret_names" {
  description = "Secrets Manager secrets holding provider API keys; values are set by the owner, never in Terraform."
  type        = set(string)
  default     = ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]
}
