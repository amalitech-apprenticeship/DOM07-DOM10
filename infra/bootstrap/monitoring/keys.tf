resource "aws_key_pair" "monitoring" {
  key_name   = "monitoring-key"
  public_key = file(pathexpand("~/.ssh/monitoring-key.pub"))
}