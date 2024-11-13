import { Sequelize } from "sequelize";
import { createModelss } from "./aws-storage";

// Define the Sequelize connection
const sequelize = new Sequelize("codepushdb", "root", "root", {
  host: "localhost",
  dialect: "mysql",
});

// Seed data
const seedData = {
  accounts: [
    { id: "id_0", email: "user1@example.com", name: "User One", createdTime: new Date().getTime() },
    { id: "id_1", email: "user2@example.com", name: "User Two", createdTime: new Date().getTime() },
  ],
  tenants: [
    { id: "tenant_1", displayName: "Organization One", createdBy: "id_0" },
    { id: "tenant_2", displayName: "Organization Two", createdBy: "id_1" },
  ],
  apps: [
    { id: "id_2", name: "App One", accountId: "id_0", tenantId: "tenant_1", createdTime: new Date().getTime() },
    { id: "id_3", name: "App Two", accountId: "id_1", tenantId: "tenant_2", createdTime: new Date().getTime() },
    { id: "id_4", name: "Independent App", accountId: "id_0", createdTime: new Date().getTime() }, // App without a tenant association
  ],
  collaborators: [
    { email: "user1@example.com", accountId: "id_0", appId: "id_2", permission: "Owner", role: "Admin" },
    { email: "user2@example.com", accountId: "id_1", appId: "id_3", permission: "Owner", role: "Admin" },
  ],
  deployments: [
    {
      id: "id_5",
      name: "Deployment One",
      key: "O25dwjupnmTCC-q70qC1CzWfO73NkSR75brivk",
      appId: "id_2",
      packageId: "pkg_1", // Link deployment to package
      createdTime: new Date(),
    },
  ],
  packages: [
    {
      id: "pkg_1",  // Assign a UUID or specific ID here
      appVersion: "1.0",
      blobUrl: "https://codepush-secondary.blob.core.windows.net/storagev2/z98_ktyhgijjKQai7fIvDj6z_t6pb984637d-14f4-409d-9646-13a0665a3902",
      description: "Minor improvements",
      isDisabled: false,
      isMandatory: false,
      label: "v1",
      manifestBlobUrl: "https://codepush-secondary.blob.core.windows.net/storagev2",
      packageHash: "d581c94fa2c00b144f1b9a5cf786787826bdf4a9e12e4941c8d2541efc7518ed",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: 256994,
      uploadTime: 1731269070,
    },
  ],
  accessKeys: [
    {
      id: "id_6",
      name: "accessKey1",
      accountId: "id_0",
      createdBy: "admin",
      createdTime: new Date().getTime(),
      friendlyName: "Default Access Key",
      expires: 1735689600000,
    },
  ],
};

// Seed function
async function seed() {
  try {
    // Initialize models
    const models = createModelss(sequelize);
    // Sync database
    await sequelize.sync({ force: true });

    // Insert seed data in order
    await models.Account.bulkCreate(seedData.accounts);
    await models.Tenant.bulkCreate(seedData.tenants);
    await models.App.bulkCreate(seedData.apps);
    await models.Collaborator.bulkCreate(seedData.collaborators);
    await models.Package.bulkCreate(seedData.packages);
    await models.Deployment.bulkCreate(seedData.deployments);
    await models.AccessKey.bulkCreate(seedData.accessKeys);

    console.log("Seed data has been inserted successfully.");
  } catch (error) {
    console.error("Error seeding data:", error);
  } finally {
    await sequelize.close();
  }
}

// Run the seed function
seed();
