// Seed data for Azurite local Azure Storage emulator
const { TableClient, TableServiceClient, AzureNamedKeyCredential } = require("@azure/data-tables");

// Azurite connection config (uses dev storage)
const account = "devstoreaccount1";
const accountKey = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const tableEndpoint = "http://127.0.0.1:10002/devstoreaccount1";

// Create credential and client
const credential = new AzureNamedKeyCredential(account, accountKey);
// Allow insecure connections for local development
const tableServiceClient = new TableServiceClient(
  tableEndpoint, 
  credential,
  { allowInsecureConnection: true }
);

// Seed data structure (same as in your MySQL script)
const seedData = {
  accounts: [
    { partitionKey: "Account", rowKey: "id_0", email: "user1@example.com", name: "User One", createdTime: new Date().getTime().toString() },
    { partitionKey: "Account", rowKey: "id_1", email: "user2@example.com", name: "User Two", createdTime: new Date().getTime().toString() },
  ],
  tenants: [
    { partitionKey: "Tenant", rowKey: "tenant_1", displayName: "Organization One", createdBy: "id_0" },
    { partitionKey: "Tenant", rowKey: "tenant_2", displayName: "Organization Two", createdBy: "id_1" },
  ],
  apps: [
    { partitionKey: "App", rowKey: "id_2", name: "App One", accountId: "id_0", tenantId: "tenant_1", createdTime: new Date().getTime().toString() },
    { partitionKey: "App", rowKey: "id_3", name: "App Two", accountId: "id_1", tenantId: "tenant_2", createdTime: new Date().getTime().toString() },
    { partitionKey: "App", rowKey: "id_4", name: "Independent App", accountId: "id_0", createdTime: new Date().getTime().toString() },
  ],
  collaborators: [
    { partitionKey: "Collaborator", rowKey: "id_2:user1@example.com", email: "user1@example.com", accountId: "id_0", appId: "id_2", permission: "Owner", role: "Admin" },
    { partitionKey: "Collaborator", rowKey: "id_3:user2@example.com", email: "user2@example.com", accountId: "id_1", appId: "id_3", permission: "Owner", role: "Admin" },
  ],
  deployments: [
    {
      partitionKey: "Deployment", 
      rowKey: "id_5",
      name: "Deployment One",
      key: "O25dwjupnmTCC-q70qC1CzWfO73NkSR75brivk",
      appId: "id_2",
      packageId: "pkg_1",
      createdTime: "1731269070",
    },
    {
      partitionKey: "Deployment", 
      rowKey: "id_6",
      name: "Deployment for App Two",
      key: "deployment_key_2",
      appId: "id_3",
      packageId: "pkg_current_2",
      createdTime: "1731269070",
    },
  ],
  // Add deployment key pointers with the correct format (using SPACE as delimiter)
  deploymentKeyPointers: [
    {
      partitionKey: "deploymentKey O25dwjupnmTCC-q70qC1CzWfO73NkSR75brivk", 
      rowKey: "",
      appId: "id_2",
      deploymentId: "id_5"
    },
    {
      partitionKey: "deploymentKey deployment_key_2", 
      rowKey: "",
      appId: "id_3",
      deploymentId: "id_6"
    }
  ],
  packages: [
    {
      partitionKey: "Package", 
      rowKey: "pkg_1",
      appVersion: "1.0.0",
      blobUrl: "https://codepush-secondary.blob.core.windows.net/storagev2/z98_ktyhgijjKQai7fIvDj6z_t6pb984637d-14f4-409d-9646-13a0665a3902",
      description: "Minor improvements",
      isDisabled: "false",
      isMandatory: "false",
      label: "v1",
      manifestBlobUrl: "https://codepush-secondary.blob.core.windows.net/storagev2",
      packageHash: "d581c94fa2c00b144f1b9a5cf786787826bdf4a9e12e4941c8d2541efc7518ed",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: "256994",
      uploadTime: "1731269070",
      deploymentId: "id_5",
      rollout: "100",
    },
    {
      partitionKey: "Package", 
      rowKey: "pkg_current_1",
      appVersion: "1.0.0",
      blobUrl: "https://example.com/blob_v1",
      description: "Current version of App One",
      isDisabled: "false",
      isMandatory: "true",
      label: "v2",
      manifestBlobUrl: "https://example.com/manifest_v1",
      packageHash: "hash_1",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: "1024",
      uploadTime: new Date().getTime().toString(),
      deploymentId: "id_5",
      rollout: "100",
    },
    {
      partitionKey: "Package", 
      rowKey: "pkg_current_2",
      appVersion: "1.2.0",
      blobUrl: "https://example.com/blob_v2",
      description: "Current version of App Two",
      isDisabled: "false",
      isMandatory: "false",
      label: "v2",
      manifestBlobUrl: "https://example.com/manifest_v2",
      packageHash: "hash_2",
      releasedBy: "user2@example.com",
      releaseMethod: "Upload",
      size: "2048",
      uploadTime: new Date().getTime().toString(),
      deploymentId: "id_6",
      rollout: "100",
    },
    {
      partitionKey: "Package", 
      rowKey: "pkg_hist_1",
      appVersion: "1.2.3",
      blobUrl: "https://example.com/blob_v0.9",
      description: "Previous version of App One",
      isDisabled: "false",
      isMandatory: "false",
      label: "v3",
      manifestBlobUrl: "https://example.com/manifest_v0.9",
      packageHash: "hash_old_1",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: "900",
      uploadTime: (new Date().getTime() - 1000000).toString(),
      deploymentId: "id_5",
      rollout: "100",
    },
  ],
  accessKeys: [
    {
      partitionKey: "AccessKey", 
      rowKey: "id_6",
      name: "accessKey1",
      accountId: "id_0",
      createdBy: "admin",
      createdTime: new Date().getTime().toString(),
      friendlyName: "Default Access Key",
      expires: "1735689600000",
      scope: "all",
    },
  ],
};

// Function to create table and insert entities
async function seedTable(tableName, entities) {
  console.log(`Creating table ${tableName}...`);
  
  try {
    await tableServiceClient.createTable(tableName);
    console.log(`Created table ${tableName}`);

    const tableClient = new TableClient(
      tableEndpoint, 
      tableName, 
      credential,
      { allowInsecureConnection: true }
    );
    
    for (const entity of entities) {
      console.log(`Adding entity to ${tableName}: ${entity.rowKey}`);
      await tableClient.createEntity(entity);
    }
    
    console.log(`Successfully seeded ${entities.length} entities to ${tableName}`);
  } catch (error) {
    // If table already exists, just add entities
    if (error.code === 'TableAlreadyExists') {
      console.log(`Table ${tableName} already exists, adding entities...`);
      const tableClient = new TableClient(
        tableEndpoint, 
        tableName, 
        credential,
        { allowInsecureConnection: true }
      );
      
      for (const entity of entities) {
        try {
          console.log(`Adding entity to ${tableName}: ${entity.rowKey}`);
          await tableClient.createEntity(entity);
        } catch (entityError) {
          if (entityError.code === 'EntityAlreadyExists') {
            console.log(`Entity ${entity.rowKey} already exists in ${tableName}`);
          } else {
            console.error(`Error adding entity ${entity.rowKey} to ${tableName}:`, entityError);
          }
        }
      }
      console.log(`Finished seeding ${tableName}`);
    } else {
      console.error(`Error creating table ${tableName}:`, error);
    }
  }
}

// Main function to seed all tables
async function seedAll() {
  try {
    // Create system table that CodePush requires
    await seedTable('storagev2', [
      { partitionKey: 'schema', rowKey: 'version', value: '2' }
    ]);
    
    // Seed each table with its data
    await seedTable('accounts', seedData.accounts);
    await seedTable('tenants', seedData.tenants);
    await seedTable('apps', seedData.apps);
    await seedTable('collaborators', seedData.collaborators);
    await seedTable('deployments', seedData.deployments);
    // Add the deployment key pointers to the storagev2 table
    await seedTable('storagev2', seedData.deploymentKeyPointers);
    await seedTable('packages', seedData.packages);
    await seedTable('accessKeys', seedData.accessKeys);
    
    console.log('✅ All data seeded successfully');
  } catch (error) {
    console.error('Error seeding data:', error);
  }
}

// Run the seed function
seedAll().catch(console.error); 