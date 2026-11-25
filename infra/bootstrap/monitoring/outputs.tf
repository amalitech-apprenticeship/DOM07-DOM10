output "monitoring_sg_id" {
  value = aws_security_group.monitoring_sg.id
}
output "monitoring_private_ip" {
  value = aws_instance.monitoring_server.private_ip
}
output "monitoring_public_ip" {
  value = aws_instance.monitoring_server.public_ip
}
