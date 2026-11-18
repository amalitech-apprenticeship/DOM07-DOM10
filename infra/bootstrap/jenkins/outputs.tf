output "jenkins-url" {
  value = "http://${aws_instance.jenkins-server.public_dns}:8080"
}

output "jenkins-public-ip" {
  value = aws_instance.jenkins-server.public_ip
}

