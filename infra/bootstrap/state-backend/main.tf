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

resource "random_id" "bootstrap" {
  byte_length = 8
}

resource "aws_s3_bucket" "bootstrap" {
  bucket              = "bootstrap-${random_id.bootstrap.hex}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id
  rule {
    default_retention {
      days = 7
    }
  }
}
