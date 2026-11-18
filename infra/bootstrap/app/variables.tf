variable "aws_region" {
  description = "The AWS region to deploy resources in."
  type        = string
  default     = "eu-west-1"
}

variable "my_ip" {
  type        = string
}

variable "public_key_path" {
  description = "Public half of the key Jenkins uses to deploy (private half goes in the ec2_ssh credential)"
  type        = string
}