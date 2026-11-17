terraform {
  backend "s3" {
    bucket = ""
    key = "jenkins"
    region = "eu-west-1"
    use_lockfile = true
  }
}