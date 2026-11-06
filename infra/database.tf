# PostgreSQL 16 on RDS, smallest instance (about USD 13-16/month in eu-central-1 incl.
# 20 GB storage; check the AWS pricing page before applying). Private, encrypted,
# backed up, and with the master password generated and stored by RDS itself in
# Secrets Manager (manage_master_user_password), so it never appears in Terraform state.

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 50 # storage autoscaling ceiling (cost guard)
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = "ctt"
  username                    = "ctt"
  manage_master_user_password = true # RDS generates + rotates it in Secrets Manager

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false # single AZ: a monthly batch job tolerates a rare outage

  backup_retention_period    = 7
  deletion_protection        = true # `terraform destroy` cannot drop the measurements by accident
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.project}-db-final"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
}
