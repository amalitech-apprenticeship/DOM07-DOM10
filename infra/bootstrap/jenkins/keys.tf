resource "aws_key_pair" "jenkins" {
  key_name   = "jenkins-key"
  public_key = file(pathexpand("~/.ssh/jenkins-key.pub"))
}
