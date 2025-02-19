resource "azurerm_resource_group" "root" {
  name		= "rg-appservice-codepush-server-${var.environment}"
  location	= var.location
}


// Define the service plan to be used for the App Service
resource "azurerm_app_service_plan" "root" {
  name				  = "codepush-server-service-plan-${var.environment}"
  kind                = "Linux"
  reserved            = true
  location            = var.location
  resource_group_name = azurerm_resource_group.root.name

  sku {
    tier = "Premium"
    size = "P0V3"
  }
}

// Define the primary instance of the application
resource "azurerm_app_service" "root" {
  name                = "codepush-server-app-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.root.name
  app_service_plan_id = azurerm_app_service_plan.root.id
  https_only          = true

  app_settings = {
    GITHUB_CLIENT_ID     = var.github_id
    GITHUB_CLIENT_SECRET = var.github_secret
    REDIS_CONN_STRING    = var.redis_conn_string
    AZURE_STORAGE_ACCESS_KEY = var.redis_storage_access_key
    AZURE_STORAGE_ACCOUNT= var.redis_azure_storage_account
    LOGGING = true
  }

  identity {
    type = "SystemAssigned"
  }
}


resource "azurerm_storage_account" "storage_account" {
  name                     = "codepushstorage${var.environment}"
  location                 = azurerm_resource_group.root.location
  resource_group_name      = azurerm_resource_group.root.name
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_network_security_group" "network_security" {
  name                = "codepush-server-security-group"
  location            = azurerm_resource_group.root.location
  resource_group_name = azurerm_resource_group.root.name
}


resource "azurerm_virtual_network" "virtual_network" {
  name                = "codepush-server-vnet-${var.environment}"
  location            = azurerm_resource_group.root.location
  resource_group_name = azurerm_resource_group.root.name
  address_space       = ["10.0.0.0/16"]

  subnet {
    name             = "subnet1"
    address_prefixes = ["10.0.1.0/24"]
    security_group   = azurerm_network_security_group.network_security.id
  }
}

resource "azurerm_redis_cache" "redis" {
  name                 = "codepush-server-redis-${var.environment}"
  location             = azurerm_resource_group.root.location
  resource_group_name  = azurerm_resource_group.root.name
  capacity             = 2
  family               = "C"
  sku_name             = "Standard"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
  public_network_access_enabled = "false"

  redis_configuration {
  active_directory_authentication_enabled = "true"
  }
}

// Auto-scaling policy

 
