resource "aws_key_pair" "jenkins" {
  key_name   = "jenkins-key"
  public_key = file(pathexpand(var.public_key_path))
}