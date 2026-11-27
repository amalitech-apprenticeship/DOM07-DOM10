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

data "aws_subnet" "monitoring-subnet" {
  vpc_id = data.aws_vpc.this.id

  filter {
    name   = "tag:Name"
    values = ["monitoring-subnet"]
  }
}


resource "aws_security_group" "monitoring_sg" {
  name        = "monitoring-sg"
  description = "Security group for monitoring server"
  vpc_id      = data.aws_vpc.this.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "monitoring-sg"
  }
}


resource "aws_instance" "monitoring_server" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.small"
  subnet_id                   = data.aws_subnet.monitoring-subnet.id
  vpc_security_group_ids      = [aws_security_group.monitoring_sg.id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.monitoring.key_name
  iam_instance_profile        = aws_iam_instance_profile.monitoring.name

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = "monitoring-server"
    Role = "monitoring"
  }
}

