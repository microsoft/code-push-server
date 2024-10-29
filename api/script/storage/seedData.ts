import { Sequelize } from 'sequelize';
import { createModelss } from './aws-storage';

// Define the Sequelize connection
const sequelize = new Sequelize('codepushdb', 'codepush', 'root', {
  host: 'localhost',
  dialect: 'mysql',
});

// Seed data
const seedData = {
  accounts: [
    { id: 'id_0', email: 'user1@example.com', name: 'User One', tenant_id: 'id_0', createdTime: new Date().getTime() },
    { id: 'id_1', email: 'user2@example.com', name: 'User Two', tenant_id: 'id_1', createdTime: new Date().getTime() },
  ],
  apps: [
    { id: 'id_2', name: 'App One', tenant_id: 'id_0', accountId: 'id_0', createdTime: new Date().getTime() },
    { id: 'id_3', name: 'App Two', tenant_id: 'id_1', accountId: 'id_1', createdTime: new Date().getTime() },
  ],
  collaborators: [
    { email: 'user1@example.com', accountId: 'id_0', appId: 'id_2', permission: 'Owner' },
    { email: 'user2@example.com', accountId: 'id_1', appId: 'id_3', permission: 'Owner' },
  ],
  deployments: [
    {
      id: 'id_4',
      name: 'Deployment One',
      key: 'O25dwjupnmTCC-q70qC1CzWfO73NkSR75brivk',
      appId: 'id_2',
      createdTime: new Date(),
    },
  ],
  packages: [
    {
      appVersion: '1.0',
      blobUrl: 'https://codepush-secondary.blob.core.windows.net/storagev2/z98_ktyhgijjKQai7fIvDj6z_t6pb984637d-14f4-409d-9646-13a0665a3902',
      description: 'Minor improvements',
      isDisabled: false,
      isMandatory: false,
      label: 'v1',
      manifestBlobUrl: 'https://codepush-secondary.blob.core.windows.net/storagev2',
      packageHash: 'd581c94fa2c00b144f1b9a5cf786787826bdf4a9e12e4941c8d2541efc7518ed',
      releasedBy: 'user1@example.com',
      releaseMethod: 'Upload',
      size: 256994,
      uploadTime: new Date(),
      deploymentId: 'id_4', // Linked to deployment
    },
  ],
  accessKeys: [
    {
      id: 'id_5',
      name: 'accessKey1',
      accountId: 'id_0',
      createdBy: 'admin',
      createdTime: new Date().getTime(),
      friendlyName: 'Default Access Key',
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
    await sequelize.sync();

    // Insert seed data
    //await models.Account.bulkCreate(seedData.accounts);
    await models.App.bulkCreate(seedData.apps);
    await models.Collaborator.bulkCreate(seedData.collaborators);
    await models.Deployment.bulkCreate(seedData.deployments);
    await models.Package.bulkCreate(seedData.packages);
    await models.AccessKey.bulkCreate(seedData.accessKeys);

    console.log('Seed data has been inserted successfully.');
  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await sequelize.close();
  }
}

// Run the seed function
seed();
