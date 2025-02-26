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

variable "redis_conn_string" {
  type        = string
  description = "Azure redis connection string"
}
variable "redis_storage_access_key" {
  type        = string
  description = "Azure Redis storage access key"
}
variable "redis_azure_storage_account" {
  type        = string
  description = "Azure Redis storage account name"
}

variable "server_url" {
  type        = string
  description = "App service url" 
}


