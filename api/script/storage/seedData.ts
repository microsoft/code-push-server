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
      createdTime: 1731269070,
    },
    {
      id: "id_6",
      name: "Deployment for App Two",
      key: "deployment_key_2",
      appId: "id_3",
      packageId: "pkg_current_2", // Link to the current package
      createdTime: 1731269070,
    },
  ],
  packages: [
    {
      id: "pkg_1",  // Assign a UUID or specific ID here
      appVersion: "1.0.0",
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
      deploymentId: "id_5",
      rollout: 100,
    },
    {
      id: "pkg_current_1",
      appVersion: "1.0.0",
      blobUrl: "https://example.com/blob_v1",
      description: "Current version of App One",
      isDisabled: false,
      isMandatory: true,
      label: "v2",
      manifestBlobUrl: "https://example.com/manifest_v1",
      packageHash: "hash_1",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: 1024,
      uploadTime: new Date().getTime(),
      deploymentId: "id_5", // Links to the current deployment
      rollout: 100,
    },
    {
      id: "pkg_current_2",
      appVersion: "1.2.0",
      blobUrl: "https://example.com/blob_v2",
      description: "Current version of App Two",
      isDisabled: false,
      isMandatory: false,
      label: "v2",
      manifestBlobUrl: "https://example.com/manifest_v2",
      packageHash: "hash_2",
      releasedBy: "user2@example.com",
      releaseMethod: "Upload",
      size: 2048,
      uploadTime: new Date().getTime(),
      deploymentId: "id_6", // Links to the current deployment
      rollout: 100,
    },
    {
      id: "pkg_hist_1",
      appVersion: "1.2.3",
      blobUrl: "https://example.com/blob_v0.9",
      description: "Previous version of App One",
      isDisabled: false,
      isMandatory: false,
      label: "v3",
      manifestBlobUrl: "https://example.com/manifest_v0.9",
      packageHash: "hash_old_1",
      releasedBy: "user1@example.com",
      releaseMethod: "Upload",
      size: 900,
      uploadTime: new Date().getTime() - 1000000,
      deploymentId: "id_5",
      rollout: 100,
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
      scope: "all",
    },
  ],
};

// Seed function
async function seed() {
  try {
    // Initialize models
    const models = createModelss(sequelize);
    // // Sync database
    // await sequelize.sync({ force: true });
    await sequelize.sync({ alter: true }); // Alters tables without dropping them


    // // Insert seed data in order
    await models.Account.bulkCreate(seedData.accounts);
    await models.Tenant.bulkCreate(seedData.tenants);
    await models.App.bulkCreate(seedData.apps);
    await models.Collaborator.bulkCreate(seedData.collaborators);
        // Insert deployments with `currentPackageId` temporarily set to `null`
    await models.Deployment.bulkCreate(seedData.deployments.map((deployment) => ({
          ...deployment,
          packageId: null, // Temporarily set to null to break circular dependency
    })));
    await models.Package.bulkCreate(seedData.packages);
    await Promise.all(seedData.deployments.map(async (deployment) => {
      if (deployment.packageId) {
        await models.Deployment.update(
          { packageId: deployment.packageId },
          { where: { id: deployment.id } }
        );
      }
    }));
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
