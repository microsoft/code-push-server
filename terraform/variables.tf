variable "location" {
    type = string
    default = "Central US"
}

variable "github_id" {
    type = string
    description = "Github oath client Id"
}

variable "github_secret" {
    type = string
    description = "Github oath client secret"
}

variable "environment" {
  type        = string
  description = "Environment to which the application belongs"
}


