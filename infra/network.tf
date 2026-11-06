# Network. Cost decision: NO NAT gateway (~USD 35/month). The runner task sits in a
# public subnet with a public IP so it can reach the model APIs over HTTPS, and its
# security group allows NO inbound traffic at all. The database sits in private
# subnets and is reachable only from the runner's security group.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2) # RDS needs subnets in 2 AZs
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true # needed for the RDS endpoint hostname
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index) # 10.40.0.0/24, 10.40.1.0/24
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # the task asks for a public IP explicitly (ecs.tf)
  tags                    = { Name = "${var.project}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index) # 10.40.10.0/24, 10.40.11.0/24
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}

# Public subnets route to the internet; private subnets have no route out at all.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Runner: no ingress rules = nothing can connect to it. Egress only HTTPS (model APIs,
# ECR, Secrets Manager, S3, CloudWatch) and Postgres to the database.
resource "aws_security_group" "runner" {
  name        = "${var.project}-runner"
  description = "Scheduled runner: no inbound; outbound HTTPS and Postgres only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "runner_https" {
  security_group_id = aws_security_group.runner.id
  description       = "HTTPS to model APIs and AWS services"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "runner_postgres" {
  security_group_id            = aws_security_group.runner.id
  description                  = "Postgres to the database only"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Postgres: inbound only from the runner"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_runner" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the runner security group"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.runner.id
}
