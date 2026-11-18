data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

data "aws_vpc" "this" {
  tags = {
    Name = "bookstore-vpc"
  }
}

data "aws_subnet" "server-subnet" {
  vpc_id = data.aws_vpc.this.id

  filter {
    name   = "tag:Name"
    values = ["server-subnet"]
  }
}

data "aws_security_group" "jenkins" {
  name   = "jenkins-sg"
  vpc_id = data.aws_vpc.this.id
}

resource "aws_security_group" "app_sg" {
  name        = "app-sg"
  description = "Security group for the app server"
  vpc_id      = data.aws_vpc.this.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description     = "SSH from Jenkins only (connect via the private IP)"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [data.aws_security_group.jenkins.id]
  }

  ingress {
    description = "SSH from my IP for debugging"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    description = "All outbound (image pulls, package installs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "server-sg" }
}

resource "aws_instance" "app_server" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.micro"
  subnet_id                   = data.aws_subnet.server-subnet.id
  vpc_security_group_ids      = [aws_security_group.app_sg.id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.app_deploy.key_name
  iam_instance_profile        = aws_iam_instance_profile.app.name

  root_block_device {
    volume_size = 16
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = "app-server"
    Role = "app"
  }
}