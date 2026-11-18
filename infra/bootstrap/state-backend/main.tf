terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
}

resource "random_id" "state-backend" {
  byte_length = 8
}

resource "aws_s3_bucket" "state-backend" {
  bucket              = "state-backend-${random_id.state-backend.hex}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "state-backend" {
  bucket = aws_s3_bucket.state-backend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "state-backend" {
  bucket = aws_s3_bucket.state-backend.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 7
    }
  }
}
