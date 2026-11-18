variable "my_ip" {
  description = "Your public IP address for SSH access"
  type        = string
}

variable "public_key_path" {
  description = "Path to the SSH public key used to reach Jenkins (for Ansible)"
  type        = string
}

variable "aws_region" {
  description = "The AWS region to deploy resources in."
  type        = string
  default     = "eu-west-1"
}