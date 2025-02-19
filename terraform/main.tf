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
    WEBSITE_NODE_DEFAULT_VERSION = "18-lts"
    CORS_ORIGIN = var.server_url
    SERVER_URL = var.server_url
  }
  site_config {
   ip_restriction {
      name                      = "Allow access from vnet"
      virtual_network_subnet_id = azurerm_subnet.subnet.id
      priority                  = "200"
    }
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
}

resource "azurerm_subnet" "subnet" {
  name                 = "codepush-server-subnet-${var.environment}"
  resource_group_name  = azurerm_resource_group.root.name
  virtual_network_name = azurerm_virtual_network.virtual_network.name
  address_prefixes     = ["10.0.1.0/24"]
    delegation {
    name = "delegation"
    service_delegation {
      name    = "Microsoft.Web/serverFarms"
    }
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

resource "azurerm_app_service_virtual_network_swift_connection" "virtual_network_connection" {
  app_service_id = azurerm_app_service.root.id
  subnet_id      = azurerm_subnet.subnet.id
}

resource "azurerm_private_dns_zone" "dns" {
  name                = "codepush.privatelink.redis.cache.windows.net"
  resource_group_name = azurerm_resource_group.root.name
}

resource "azurerm_private_endpoint" "redis_private_endpoint" {
  name                = "codepush-redis-private-endpoint-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.root.name
  subnet_id           = azurerm_subnet.subnet.id

   private_dns_zone_group {
    name                 = "codepushprivatednsrediszonegroup"
    private_dns_zone_ids = [azurerm_private_dns_zone.dns.id]
  }

  private_service_connection {
    name                           = "codepushserviceconnection"
    private_connection_resource_id = azurerm_redis_cache.redis.id
    is_manual_connection           = false
    subresource_names              = ["redisCache"]
  }
}


resource "azurerm_private_dns_zone_virtual_network_link" "virtual_network_link" {
  name                  = "codepush-virtual-link-${var.environment}"
  private_dns_zone_name = azurerm_private_dns_zone.dns.name
  virtual_network_id    = azurerm_virtual_network.virtual_network.id
  resource_group_name   = azurerm_resource_group.root.name
}
// Auto-scaling policy

 
