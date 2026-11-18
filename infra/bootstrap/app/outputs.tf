output "app_instance_id" {
  value = aws_instance.app_server.id
}

output "app_private_ip" {
  description = "Use this from Jenkins for SSH/Ansible"
  value       = aws_instance.app_server.private_ip
}

output "app_public_ip" {
  value = aws_instance.app_server.public_ip
}

output "app_url" {
  value = "http://${aws_instance.app_server.public_dns}"
}