resource "aws_key_pair" "app_deploy" {
  key_name   = "app-key"
  public_key = file(pathexpand("~/.ssh/app-deploy-key.pub"))
}