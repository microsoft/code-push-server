// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

param project_suffix string
param az_location string = 'eastus'
@secure()
param github_client_id string
param github_client_secret string
@secure()
param microsoft_client_id string
param microsoft_client_secret string
param logging bool = true

var storageAccountName = 'codepushstorage${project_suffix}'
var webAppName = 'codepush-${project_suffix}'
var servicePlanName = 'codepush-asp-${project_suffix}'
var serverUrl = 'https://codepush-${project_suffix}.azurewebsites.net'
var redisCacheName = 'codepush-redis-${project_suffix}'
var vnetName = 'codepush-vnet-${project_suffix}'
var vnetAddressPrefix = '10.0.0.0/16'
var backendSubnetName = 'backend-subnet'
var backendSubnetPrefix = '10.0.0.0/24'
var privateEndpointSubnetName = 'privatelink-subnet'
var privateEndpointSubnetPrefix = '10.0.1.0/24'

targetScope = 'resourceGroup'

resource servicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: servicePlanName
  location: az_location
  properties: {
    reserved: true
  }
  sku: {
    name: 'S1'
    tier: 'Standard'
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2022-09-01' = {
  name: storageAccountName
  location: az_location
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    publicNetworkAccess: 'Enabled'
  }
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}

resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisCacheName
  location: az_location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
  name: vnetName
  location: az_location
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: backendSubnetName
        properties: {
          addressPrefix: backendSubnetPrefix
          delegations: [
            {
              name: 'delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverfarms'
              }
            }
          ]
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource webAppVnetConnection 'Microsoft.Web/sites/networkConfig@2022-03-01' = {
  parent: webApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: vnet.properties.subnets[0].id
    swiftSupported: true
  }
}

resource webApp 'Microsoft.Web/sites@2022-03-01' = {
  name: webAppName
  location: az_location
  properties: {
    serverFarmId: servicePlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      alwaysOn: true
      linuxFxVersion: 'NODE|18-lts'
      scmType: 'LocalGit'
      appSettings: [
        { name: 'AZURE_STORAGE_ACCOUNT', value: storageAccount.name }
        { name: 'AZURE_STORAGE_ACCESS_KEY', value: storageAccount.listKeys().keys[0].value }
        { name: 'GITHUB_CLIENT_ID', value: github_client_id }
        { name: 'GITHUB_CLIENT_SECRET', value: github_client_secret }
        { name: 'MICROSOFT_CLIENT_ID', value: microsoft_client_id }
        { name: 'MICROSOFT_CLIENT_SECRET', value: microsoft_client_secret }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '18-lts' }
        { name: 'SERVER_URL', value: serverUrl }
        { name: 'CORS_ORIGIN', value: serverUrl }
        { name: 'LOGGING', value: logging ? 'true' : 'false' }
        { name: 'REDIS_CONN_STRING', value: 'redis://default:${redisCache.listKeys().primaryKey}@${redisCache.properties.hostName}:${redisCache.properties.sslPort}' }
      ]
    }
  }
}

resource scmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2022-03-01' = {
  name: 'scm'
  parent: webApp
  properties: {
    allow: true
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: '${redisCacheName}-endpoint'
  location: az_location
  properties: {
    subnet: {
      id: vnet.properties.subnets[1].id
    }
    privateLinkServiceConnections: [
      {
        name: '${redisCacheName}-connection'
        properties: {
          privateLinkServiceId: redisCache.id
          groupIds: ['redisCache']
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.redis.cache.windows.net'
  location: 'global'
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: '${vnetName}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-05-01' = {
  parent: privateEndpoint
  name: 'dnsgroupname'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'config1'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}
