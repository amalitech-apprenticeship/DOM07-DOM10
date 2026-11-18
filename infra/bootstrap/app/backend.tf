terraform {
  backend "s3" {
    bucket       = "state-backend-e952d9c914d8a5b7"
    key          = "app-host/terraform.tfstate"
    region       = "eu-west-1"
    use_lockfile = true
    encrypt      = true
  }
}
