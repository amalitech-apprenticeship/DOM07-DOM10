output "vpc-id" {
  value = aws_vpc.this.id
}

output "jenkins-subnet-id" {
  value = aws_subnet.jenkins-subnet.id
}

output "server-subnet-id" {
  value = aws_subnet.server-subnet.id
}