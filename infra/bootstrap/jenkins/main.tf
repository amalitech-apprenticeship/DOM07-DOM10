data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}


resource "aws_instance" "jenkins-server" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.small"
  subnet_id                   = var.jenkins_subnet_id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.jenkins-sg.id]
  iam_instance_profile        = aws_iam_instance_profile.jenkins.name
  key_name                    = aws_key_pair.jenkins.key_name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = "jenkins-server"
    Role = "jenkins"
  }


}

resource "aws_security_group" "jenkins-sg" {
  name        = "jenkins-sg"
  description = "Security group for Jenkins server"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    from_port   = 22
    to_port     = 22
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
    Name = "jenkins-sg"
  }
}
