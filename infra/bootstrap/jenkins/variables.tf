variable "jenkins_subnet_id" {
  description = "The subnet ID where the Jenkins server will be deployed"
  type        = string  
}

variable "my_ip" {
  description = "Your public IP address for SSH access"
  type        = string
}

variable "public_key_path" {
  description = "Path to the SSH public key used to reach Jenkins (for Ansible)"
  type        = string
}