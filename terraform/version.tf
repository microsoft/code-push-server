
terraform {
  cloud {
    organization = "frontier-devops"
  }
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.1"
    }
  }
  required_version = "~> 1.0"
}

provider "azurerm" {
  features {}
  skip_provider_registration  = true
}
