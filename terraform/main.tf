resource "azurerm_resource_group" "root" {
  name		= "rg-appservice-codepush-server-${var.environment}"
  location	= var.location
}


// Define the service plan to be used for the App Service
resource "azurerm_service_plan" "root" {
  name				  = "codepush-server-service-plan-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.root.name
  os_type = "Linux"
  sku_name = "P0v3"

}

// Define the primary instance of the application
resource "azurerm_linux_web_app" "root" {
  name                = "codepush-server-app-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.root.name
  service_plan_id = azurerm_service_plan.root.id
  https_only          = true
 site_config {
   always_on = true
   health_check_path = "/"
 
   application_stack   {
    node_version = "18-lts"
  }
 }
  app_settings =  {
    GITHUB_CLIENT_ID     = var.github_id
    GITHUB_CLIENT_SECRET = var.github_secret
    AZURE_STORAGE_ACCESS_KEY = var.redis_storage_access_key
    AZURE_STORAGE_ACCOUNT= var.redis_azure_storage_account
    LOGGING = true
    WEBSITE_NODE_DEFAULT_VERSION = "18-lts"
    CORS_ORIGIN = var.server_url
    SERVER_URL = var.server_url
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
  name                = "codepush-vnet-${var.environment}"
  location            = azurerm_resource_group.root.location
  resource_group_name = azurerm_resource_group.root.name
  address_space       = ["10.0.0.0/16"]

  subnet {
    name             = "subnet1"
    address_prefixes = ["10.0.0.0/24"]
  }
  subnet {
    name              = "subnetwithdelegation"
    address_prefixes    = ["10.0.1.0/24"]
    delegation {
      name = "subnetdelegation"

      service_delegation {
        name    = "Microsoft.Web/serverFarms"
      }
    }
  }
}


resource "azurerm_app_service_virtual_network_swift_connection" "virtual_conn" {
  app_service_id = azurerm_linux_web_app.root.id
  subnet_id      = "${azurerm_virtual_network.virtual_network.subnet.*.id[1]}"
}

 
