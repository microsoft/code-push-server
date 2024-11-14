import * as q from "q";
import * as storage from "./storage";
import { S3} from "aws-sdk";
import {HeadBucketRequest, CreateBucketRequest} from "aws-sdk/clients/s3"
import * as stream from "stream";
import { Sequelize, DataTypes } from "sequelize";
//import * from nanoid;
import * as shortid from "shortid";
import * as utils from "../utils/common";

//Creating Access Key
export function createAccessKey(sequelize: Sequelize) {
    return sequelize.define("accessKey", {
        createdBy: { type: DataTypes.STRING, allowNull: false },
        createdTime: { type: DataTypes.FLOAT, allowNull: false },
        expires: { type: DataTypes.FLOAT, allowNull: false },
        description: { type: DataTypes.STRING, allowNull: true },
        friendlyName: { type: DataTypes.STRING, allowNull: false},
        name: { type: DataTypes.STRING, allowNull: false},
        id: { type: DataTypes.STRING, allowNull: false, primaryKey: true},
        isSession: { type: DataTypes.BOOLEAN, allowNull: true},
        accountId: { type: DataTypes.STRING, allowNull: false, references: {
            model: sequelize.models["account"],
            key: 'id',
          },},
    })
}

//Creating Account Type
export function createAccount(sequelize: Sequelize) {
  return sequelize.define("account", {
    createdTime: { type: DataTypes.FLOAT, allowNull: false, defaultValue: () => new Date().getTime() },  // Set default value
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
  });
}


//Creating App

export function createApp(sequelize: Sequelize) {
    return sequelize.define("apps", {
        createdTime: { type: DataTypes.FLOAT, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
        id: { type: DataTypes.STRING, allowNull: false, primaryKey:true},
        accountId: { type: DataTypes.STRING, allowNull: false, references: {
            model: sequelize.models["account"],
            key: 'id',
          },
        },
        tenantId: {
          type: DataTypes.UUID,
          allowNull: true,
          references: {
            model: 'tenants',
            key: 'id',
          },
        },
    })
}


//Creating Tenants/Orgs

export function createTenant(sequelize: Sequelize) {
  return sequelize.define("tenant", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'accounts',
        key: 'id',
      },
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });
}


//Create Collabarorators

export function createCollaborators(sequelize: Sequelize) {
    return sequelize.define("collaborator", {
        email: {type: DataTypes.STRING, allowNull: false},
        accountId: { type: DataTypes.STRING, allowNull: false },
        appId: { type: DataTypes.STRING, allowNull: false },
        permission: {
            type: DataTypes.ENUM({
                values: ["Collaborator", "Owner"]
            }),
            allowNull:true
        },
    })
}

//Create Deployment

export function createDeployment(sequelize: Sequelize) {
  return sequelize.define("deployment", {
      id: { type: DataTypes.STRING, allowNull: true, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      key: { type: DataTypes.STRING, allowNull: false },
      packageId: {  // Ensure this has the same type as the 'id' in 'packages'
          type: DataTypes.UUID,  // Use UUID type if 'packages.id' is a UUID
          allowNull: true,
          references: {
              model: sequelize.models["package"],
              key: 'id',
          },
      },
      appId: {
          type: DataTypes.STRING,
          allowNull: false,
          references: {
              model: sequelize.models["apps"], // Foreign key to the App model
              key: 'id',
          },
      },
      createdTime: { type: DataTypes.FLOAT, allowNull: true },
  });
}


//Create Package
export function createPackage(sequelize: Sequelize) {
  return sequelize.define("package", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, primaryKey: true },
      appVersion: { type: DataTypes.STRING, allowNull: false },
      blobUrl: { type: DataTypes.STRING },
      description: { type: DataTypes.STRING },
      diffPackageMap: { type: DataTypes.JSON, allowNull: true },
      isDisabled: DataTypes.BOOLEAN,
      isMandatory: DataTypes.BOOLEAN,
      label: { type: DataTypes.STRING, allowNull: true },
      manifestBlobUrl: { type: DataTypes.STRING, allowNull: true },
      originalDeployment: { type: DataTypes.STRING, allowNull: true },
      originalLabel: { type: DataTypes.STRING, allowNull: true },
      packageHash: { type: DataTypes.STRING, allowNull: false },
      releasedBy: { type: DataTypes.STRING, allowNull: true },
      releaseMethod: {
          type: DataTypes.ENUM({
              values: ["Upload", "Promote", "Rollback"],
          }),
      },
      rollout: { type: DataTypes.FLOAT, allowNull: true },
      size: { type: DataTypes.FLOAT, allowNull: false },
      uploadTime: { type: DataTypes.BIGINT, allowNull: false },
      deploymentId: { // Foreign key to associate this package with a deployment history
        type: DataTypes.STRING,
        allowNull: true,
        references: {
          model: sequelize.models["deployment"],
          key: 'id',
        },
      },
  });
}

//create App Pointer

export function createAppPointer(sequelize: Sequelize) {
    return sequelize.define("AppPointer", {
        id: {
          type: DataTypes.STRING,
          primaryKey: true,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4, // Generates a UUID by default
        },
        accountId: {
          type: DataTypes.STRING,
          allowNull: false,
          references: {
            model: 'accounts', // References Account model
            key: 'id',
          },
        },
        appId: {
          type: DataTypes.STRING,
          allowNull: false,
          references: {
            model: 'apps', // References App model
            key: 'id',
          },
        },
        partitionKeyPointer: {
          type: DataTypes.STRING,
          allowNull: false, // Could be useful for referencing legacy data
        },
        rowKeyPointer: {
          type: DataTypes.STRING,
          allowNull: false, // Could be useful for referencing legacy data
        },
      });
}


export function createModelss(sequelize: Sequelize) {
  // Create models and register them
  const Tenant = createTenant(sequelize);
  const Package = createPackage(sequelize);
  const Deployment = createDeployment(sequelize);
  const Account = createAccount(sequelize);
  const AccessKey = createAccessKey(sequelize);
  const AppPointer = createAppPointer(sequelize);
  const Collaborator = createCollaborators(sequelize);
  const App = createApp(sequelize);

  // Define associations

  // Account and App
  Account.hasMany(App, { foreignKey: 'accountId' });
  App.belongsTo(Account, { foreignKey: 'accountId' });

  // Account and Tenant
  Account.hasMany(Tenant, { foreignKey: 'createdBy' });
  Tenant.belongsTo(Account, { foreignKey: 'createdBy' });

  // Tenant and App (One Tenant can have many Apps)
  Tenant.hasMany(App, { foreignKey: 'tenantId' });
  App.belongsTo(Tenant, { foreignKey: 'tenantId' });

  // App and Deployment (One App can have many Deployments)
  App.hasMany(Deployment, { foreignKey: 'appId' });
  Deployment.belongsTo(App, { foreignKey: 'appId' });

  // Deployment and Package (One Package can be linked to many Deployments)
  //
  Deployment.hasMany(Package, { foreignKey: 'deploymentId', as: 'packageHistory' });
  Package.belongsTo(Deployment, { foreignKey: 'deploymentId' });
  Deployment.belongsTo(Package, { foreignKey: 'packageId', as: 'packageDetails' });
  //Package.hasMany(Deployment, { foreignKey: 'packageId', as: 'deployments' });

  // Collaborator associations (Collaborators belong to both Account and App)
  Collaborator.belongsTo(Account, { foreignKey: 'accountId' });
  Collaborator.belongsTo(App, { foreignKey: 'appId' });

  // Return all models for convenience (optional)
  return {
    Tenant,
    Package,
    Deployment,
    Account,
    AccessKey,
    AppPointer,
    Collaborator,
    App,
  };
}

export const MODELS = {
  COLLABORATOR : "collaborator",
  DEPLOYMENT : "deployment",
  APPS : "apps",
  PACKAGE : "package",
  ACCESSKEY : "accessKey",
  ACCOUNT : "account",
  APPPOINTER: "AppPointer",
  TENANT : "tenant"
}

const DB_NAME = "codepushdb"
const DB_USER = "codepush"
const DB_PASS = "root"
const DB_HOST = "localhost"

export class S3Storage implements storage.Storage {
    private s3: S3;
    private bucketName : string = "codepush-poc-bucket"
    private sequelize:Sequelize;
    private setupPromise: q.Promise<void>
    public constructor() {
        this.s3 = new S3({
          endpoint: process.env.S3_ENDPOINT, // LocalStack S3 endpoint
          s3ForcePathStyle: true,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });
        shortid.characters("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-");
        this.sequelize = new Sequelize(process.env.DB_NAME || DB_NAME, process.env.DB_USER || DB_USER, process.env.DB_PASS || DB_PASS, {
            host: process.env.DB_HOST || DB_HOST,
            dialect: 'mysql'
          });
        this.setupPromise = this.setup()
          
    }

    private setup(): q.Promise<void> {
      let headBucketParams: HeadBucketRequest = {
        Bucket: this.bucketName,
      };
    
      let createBucketParams: CreateBucketRequest = {
        Bucket: this.bucketName,
      };
    
      return q(this.s3.headBucket(headBucketParams).promise())
        .catch((err) => {
          if (err.code === 'NotFound' || err.code === 'NoSuchBucket') {
            console.log(`Bucket ${this.bucketName} does not exist, creating it...`);
            return q(this.s3.createBucket(createBucketParams).promise());
          } else if (err.code === 'Forbidden') {
            console.error('Forbidden: Check your credentials and S3 endpoint');
            throw err; // Re-throw the error after logging
          } else {
            throw err; // Other errors, re-throw them
          }
        })
        .then(() => {
          // Authenticate Sequelize and ensure models are registered
          return q.call(this.sequelize.authenticate.bind(this.sequelize));
        })
        .then(() => {
          // Create and associate models
          const models = createModelss(this.sequelize);
          console.log("Models registered");
    
          // Sync models with the database
          return q.call(this.sequelize.sync.bind(this.sequelize)); // Await Sequelize sync
        })
        .then(() => {
          console.log("Sequelize models synced");
          console.log(this.sequelize.models);  // This should list all the registered models
        })
        .catch((error) => {
          console.error('Error during setup:', error);
          throw error;
        });
    }
      

    public reinitialize(): q.Promise<void> {
      console.log("Re-initializing AWS storage");
      return this.setup();
    }
  
    public checkHealth(): q.Promise<void> {
      return q.Promise<void>((resolve, reject) => {
        this.setupPromise
          .then(() => {
            return q.all([this.sequelize.authenticate()]);
          })
          .then(() => {
            resolve();
          })
          .catch(reject);
      });
    }
  
    public addAccount(account: storage.Account): q.Promise<string> {
        account = storage.clone(account); // pass by value
        account.id = shortid.generate();
        return this.setupPromise
          .then(() => {
            return this.sequelize.models[MODELS.ACCOUNT].findOrCreate({where: {id :account.id}, defaults: {
              ...account
            }}); // Successfully fails if duplicate email
          })
          .then(() => {
            return account.id;
          })
          .catch(S3Storage.storageErrorHandler);
      }
  
    public getAccount(accountId: string): q.Promise<storage.Account> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.ACCOUNT].findByPk(accountId)
        })
        .then((acoount) => {
          return acoount.dataValues
        })
        .catch(S3Storage.storageErrorHandler);
    }
  
    public getAccountByEmail(email: string): q.Promise<storage.Account> {
        return this.setupPromise
            .then(async () => {
              const account = await this.sequelize.models[MODELS.ACCOUNT].findOne({where: {email : email}})
              return account !== null ? q.resolve(account.dataValues) : q.reject({code: 1})
            })
    }
  
    public updateAccount(email: string, updateProperties: storage.Account): q.Promise<void> {
      if (!email) throw new Error("No account email");
  
      return this.setupPromise
        .then(() => {
          this.sequelize.models[MODELS.ACCOUNT].update({
              ...updateProperties
            },{
            where: {"email" : email},
          },)
        })
        .catch(S3Storage.storageErrorHandler);
    }
  
    public getAccountIdFromAccessKey(accessKey: string): q.Promise<string> {
  
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.ACCESSKEY].findOne({
            where: {"name" : accessKey}
          })
        })
        .then((accessKey) => {
          if (new Date().getTime() >= accessKey.dataValues["expires"]) {
            throw storage.storageError(storage.ErrorCode.Expired, "The access key has expired.");
          }
  
          return accessKey.dataValues["accountId"];
        })
        .catch(S3Storage.storageErrorHandler);
    }
  
    public addApp(accountId: string, app: storage.App): q.Promise<storage.App> {
      app = storage.clone(app); // Clone the app data to avoid mutating the original
      app.id = shortid.generate();
    
      return this.setupPromise
        .then(() => this.getAccount(accountId)) // Fetch account details to check permissions
        .then(async (account: storage.Account) => {
          // Set initial tenantId and tenantName from app data
          let tenantId = app.tenantId;
          let tenantName = app.tenantName;
    
          // Check if a tenantId is provided, and if so, verify or create tenant
          if (tenantId) {
            // Attempt to find the tenant by tenantId and tenantName
            const tenant = await this.sequelize.models[MODELS.TENANT].findOne({
              where: { id: tenantId },
            });
    
            // If tenant is not found or tenantName doesn't match, create a new tenant
            if (!tenant) {
              console.warn(`Specified tenant (ID: ${tenantId}, Name: ${tenantName}) does not exist. Creating a new tenant.`);
    
              const idTogenerate = shortid.generate();
              // Create a new tenant with the specified tenantName, owned by the accountId
              const newTenant = await this.sequelize.models[MODELS.TENANT].create({
                id: idTogenerate,
                displayName: tenantName,
                createdBy: accountId,
              });
    
              tenantId = idTogenerate;
            } else {
              // Verify if the user has admin permissions for the existing tenant
              // const isAdmin = await this.sequelize.models[MODELS.COLLABORATOR].findOne({
              //   where: { accountId, tenantId, permission: storage.Permissions.Owner },
              // });
              const isAdmin = true;
              if (!isAdmin) {
                throw new Error("User does not have admin permissions for the specified tenant.");
              }
            }
          } else if(tenantName) {
            // If no tenantId is provided, set tenantId to NULL (app is standalone/personal)
            const idTogenerate = shortid.generate();
              // Create a new tenant with the specified tenantName, owned by the accountId
              const newTenant = await this.sequelize.models[MODELS.TENANT].create({
                id: idTogenerate,
                displayName: tenantName,
                createdBy: accountId,
              });
    
              tenantId = idTogenerate;
          }
    
          // Set the tenantId on the app object
          app.tenantId = tenantId;
    
          // Add the App with accountId and tenantId
          const addedApp = await this.sequelize.models[MODELS.APPS].create({
            ...app,
            accountId,
          });
    
          // Add a Collaborator entry for the app owner
          const collabMap = {
            email: account.email,
            accountId,
            permission: storage.Permissions.Owner,
            appId: app.id,
          };
          await this.sequelize.models[MODELS.COLLABORATOR].findOrCreate({
            where: { appId: app.id, email: account.email },
            defaults: collabMap,
          });
    
          return addedApp;
        })
        .then(() => app) // Return the app object
        .catch((error) => {
          console.error("Error adding app:", error.message);
          throw S3Storage.storageErrorHandler(error);
        });
    }
    

    public getApps(accountId: string): q.Promise<storage.App[]> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.APPS].findAll({
            where: { accountId },
            include: [{ model: this.sequelize.models[MODELS.TENANT], as: 'tenant' }], // Include tenant details if available
          });
        })
        .then(async (flatAppsModel) => {
          const flatApps = flatAppsModel.map((val) => val.dataValues);
          const apps = [];
          for (let i = 0; i < flatApps.length; i++) {
            const updatedApp = await this.getCollabrators(flatApps[i], accountId);
            apps.push(updatedApp);
          }
          return apps;
        })
        .catch(S3Storage.storageErrorHandler);
    }
    

    public getTenants(accountId: string): q.Promise<storage.Organization[]> {
      return this.setupPromise
        .then(() => {
          // Fetch all tenants where the account is a collaborator
          return this.sequelize.models[MODELS.TENANT].findAll({
            include: [
              {
                model: this.sequelize.models[MODELS.APPS],
                where: { accountId },
              },
            ],
          });
        })
        .then((tenantsModel) => {
          // Format tenants into the desired response structure
          const tenants = tenantsModel.map((tenantModel) => {
            const tenant = tenantModel.dataValues;
            return {
              id: tenant.id,
              displayName: tenant.displayName, // Assuming `displayName` in Tenant model holds org name
              role: "Owner",
            };
          });
    
          return tenants;
        })
        .catch(S3Storage.storageErrorHandler);
    }
    
    
    public getApp(accountId: string, appId: string, keepCollaboratorIds: boolean = false): q.Promise<storage.App> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.APPS].findByPk(appId, {
            include: [{ model: this.sequelize.models[MODELS.TENANT], as: 'tenant' }], // Include tenant details if available
          });
        })
        .then((flatAppModel) => {
          return this.getCollabrators(flatAppModel.dataValues, accountId);
        })
        .then((app) => {
          return app;
        })
        .catch(S3Storage.storageErrorHandler);
    }
    
  
    public removeApp(accountId: string, appId: string): q.Promise<void> {
      return this.setupPromise
        .then(() => {
          // Remove all collaborator entries for this app
          return this.sequelize.models[MODELS.COLLABORATOR].destroy({
            where: { appId, accountId },
          });
        })
        .then(() => {
          // Remove the app entry
          return this.sequelize.models[MODELS.APPS].destroy({
            where: { id: appId, accountId },
          });
        })
        .catch(S3Storage.storageErrorHandler);
    }    
  
    public updateApp(accountId: string, app: storage.App): q.Promise<void> {
      const appId: string = app.id;
      if (!appId) throw new Error("No app id");
  
      return this.setupPromise
        .then(() => {
          return this.updateAppWithPermission(accountId,app,true)
        })
        .catch(S3Storage.storageErrorHandler);
    }

    
  
    //P1

    //MARK: TODO
    public transferApp(accountId: string, appId: string, email: string): q.Promise<void> {
      let app: storage.App;
      let targetCollaboratorAccountId: string;
      let requestingCollaboratorEmail: string;
      let isTargetAlreadyCollaborator: boolean;
  
      return this.setupPromise
        .then(() => {
          const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
          const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
          return q.all<any>([getAppPromise, accountPromise]);
        })
        .spread((appPromiseResult: storage.App, accountPromiseResult: storage.Account) => {
          targetCollaboratorAccountId = accountPromiseResult.id;
          email = accountPromiseResult.email; // Use the original email stored on the account to ensure casing is consistent
          app = appPromiseResult;
          requestingCollaboratorEmail = S3Storage.getEmailForAccountId(app.collaborators, accountId);
  
          if (requestingCollaboratorEmail === email) {
            throw storage.storageError(storage.ErrorCode.AlreadyExists, "The given account already owns the app.");
          }
  
          return this.getApps(targetCollaboratorAccountId);
        })
        .then((appsForCollaborator: storage.App[]) => {
          if (storage.NameResolver.isDuplicate(appsForCollaborator, app.name)) {
            throw storage.storageError(
              storage.ErrorCode.AlreadyExists,
              'Cannot transfer ownership. An app with name "' + app.name + '" already exists for the given collaborator.'
            );
          }
  
          isTargetAlreadyCollaborator = S3Storage.isCollaborator(app.collaborators, email);
  
          // Update the current owner to be a collaborator
          S3Storage.setCollaboratorPermission(app.collaborators, requestingCollaboratorEmail, storage.Permissions.Collaborator);
  
          // set target collaborator as an owner.
          if (isTargetAlreadyCollaborator) {
            S3Storage.setCollaboratorPermission(app.collaborators, email, storage.Permissions.Owner);
          } else {
            const targetOwnerProperties: storage.CollaboratorProperties = {
              accountId: targetCollaboratorAccountId,
              permission: storage.Permissions.Owner,
            };
            S3Storage.addToCollaborators(app.collaborators, email, targetOwnerProperties);
          }
  
          return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true);
        })
        .then(() => {
          if (!isTargetAlreadyCollaborator) {
            // Added a new collaborator as owner to the app, create a corresponding entry for app in target collaborator's account.
            return this.addAppPointer(targetCollaboratorAccountId, app.id);
          }
        })
        .catch(S3Storage.storageErrorHandler);
    }
  

    private addAppPointer(accountId: string, appId: string): q.Promise<void> {
        return this.setupPromise
          .then(() => {
            // Directly create the pointer in the DB using foreign keys (instead of partition/row keys)
            return this.sequelize.models[MODELS.APPPOINTER].create({
              accountId,
              appId,
              partitionKeyPointer: `accountId ${accountId}`,
              rowKeyPointer: `appId ${appId}`,
            });
          })
          .then(() => {
            console.log('App pointer added successfully');
          })
          .catch(S3Storage.storageErrorHandler);
      }
      
    //P0
    public addCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
      return this.setupPromise
        .then(() => {
          const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
          const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
          return q.all<any>([getAppPromise, accountPromise]);
        })
        .spread((app: storage.App, account: storage.Account) => {
          // Use the original email stored on the account to ensure casing is consistent
          email = account.email;
          return this.addCollaboratorWithPermissions(accountId, app, email, {
            accountId: account.id,
            permission: storage.Permissions.Collaborator,
          });
        })
        .catch(S3Storage.storageErrorHandler);
    }
  
    public getCollaborators(accountId: string, appId: string): q.Promise<storage.CollaboratorMap> {
      return this.setupPromise
        .then(() => {
          return this.getApp(accountId, appId, /*keepCollaboratorIds*/ false);
        })
        .then((app: storage.App) => {
          return q<storage.CollaboratorMap>(app.collaborators);
        })
        .catch(S3Storage.storageErrorHandler);
    }
  
    public removeCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
        return this.setupPromise
        .then(() => {
          // Get the App and Collaborators from the DB
          return this.getApp(accountId, appId, true);
        })
        .then((app: storage.App) => {
          const removedCollabProperties: storage.CollaboratorProperties = app.collaborators[email];
  
          if (!removedCollabProperties) {
            throw storage.storageError(storage.ErrorCode.NotFound, "The given email is not a collaborator for this app.");
          }
  
          // Cannot remove the owner
          if (removedCollabProperties.permission === storage.Permissions.Owner) {
            throw storage.storageError(storage.ErrorCode.AlreadyExists, "Cannot remove the owner of the app from collaborator list.");
          }
  
          // Remove the collaborator
          delete app.collaborators[email];
  
          // Update the App in the DB
          return this.updateAppWithPermission(accountId, app, true).then(() => {
            return this.removeAppPointer(removedCollabProperties.accountId, app.id);
          });
        })
        .catch(S3Storage.storageErrorHandler);
    }

    private removeAppPointer(accountId: string, appId: string): q.Promise<void> {
        return this.setupPromise
        .then(() => {
          // Use Sequelize to destroy (delete) the record
          return this.sequelize.models[MODELS.APPPOINTER].destroy({
            where: {
              accountId: accountId,
              appId: appId,
            },
          });
        })
        .then((deletedCount: number) => {
          if (deletedCount === 0) {
            throw new Error('AppPointer not found');
          }
          console.log('AppPointer successfully removed');
        })
        .catch((error: any) => {
          console.error('Error removing AppPointer:', error);
          throw error;
        });
      }

    //Utility Collaboratos methods
    private static isOwner(collaboratorsMap: storage.CollaboratorMap, email: string): boolean {
        return (
          collaboratorsMap &&
          email &&
          collaboratorsMap[email] &&
          (<storage.CollaboratorProperties>collaboratorsMap[email]).permission === storage.Permissions.Owner
        );
      }

      private static isCollaborator(collaboratorsMap: storage.CollaboratorMap, email: string): boolean {
        return (
          collaboratorsMap &&
          email &&
          collaboratorsMap[email] &&
          (<storage.CollaboratorProperties>collaboratorsMap[email]).permission === storage.Permissions.Collaborator
        );
      }

      private static setCollaboratorPermission(collaboratorsMap: storage.CollaboratorMap, email: string, permission: string): void {
        if (collaboratorsMap && email && !storage.isPrototypePollutionKey(email) && collaboratorsMap[email]) {
          (<storage.CollaboratorProperties>collaboratorsMap[email]).permission = permission;
        }
      }
    
      private static addToCollaborators(
        collaboratorsMap: storage.CollaboratorMap,
        email: string,
        collabProps: storage.CollaboratorProperties
      ): void {
        if (collaboratorsMap && email && !storage.isPrototypePollutionKey(email) && !collaboratorsMap[email]) {
          collaboratorsMap[email] = collabProps;
        }
      }

      private addCollaboratorWithPermissions(
        accountId: string,
        app: storage.App,
        email: string,
        collabProperties: storage.CollaboratorProperties
      ): q.Promise<void> {
        if (app && app.collaborators && !app.collaborators[email]) {
          app.collaborators[email] = collabProperties;
          return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true).then(() => {
            return this.addAppPointer(collabProperties.accountId, app.id);
          });
        } else {
          throw storage.storageError(storage.ErrorCode.AlreadyExists, "The given account is already a collaborator for this app.");
        }
      }


      //Deployment Methods

    
      public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<string> {
        let deploymentId: string;
        return this.setupPromise
          .then(() => {
            // Generate deployment ID
            deployment.id = shortid.generate();
            deploymentId = deployment.id;
    
            // Insert the deployment in the DB
            return this.sequelize.models[MODELS.DEPLOYMENT].create({ ...deployment, appId, createdTime: Date.now() });
          })
          // .then(() => {
          //   //MARK: TODO
          //   return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
          // })
          .then(() => {
            // Return deployment ID
            return deploymentId;
          })
          .catch(S3Storage.storageErrorHandler);
    }

    public getDeploymentInfo(deploymentKey: string): q.Promise<storage.DeploymentInfo> {
        return this.setupPromise
          .then(() => {
            return this.sequelize.models[MODELS.DEPLOYMENT].findOne({ where: { key: deploymentKey } });
          })
          .then((deployment: any): storage.DeploymentInfo => {
            if (!deployment) {
              throw storage.storageError(storage.ErrorCode.NotFound, "Deployment not found");
            }
    
            return { appId: deployment.appId, deploymentId: deployment.id };
          })
          .catch(S3Storage.storageErrorHandler);
    }


    public getDeployments(accountId: string, appId: string): q.Promise<storage.Deployment[]> {
      return this.setupPromise
        .then(() => {
          // Retrieve deployments for the given appId, including the associated Package
          return this.sequelize.models[MODELS.DEPLOYMENT].findAll({
            where: { appId: appId },
          });
        })
        .then((flatDeployments: any[]) => {
          // Use Promise.all to wait for all unflattenDeployment promises to resolve
          return Promise.all(flatDeployments.map((flatDeployment) => this.attachPackageToDeployment(accountId,flatDeployment)));
        })
        .catch((error) => {
          console.error("Error retrieving deployments:", error);
          throw error;
        });
    }

    public removeDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
        return this.setupPromise
          .then(() => {
            // Delete the deployment from the database using Sequelize
            return this.sequelize.models[MODELS.DEPLOYMENT].destroy({
              where: { id: deploymentId, appId: appId },
            });
          })
          .then(() => {
            // Delete history from S3
            return this.deleteHistoryBlob(deploymentId);
          })
          .catch((error) => {
            console.error("Error deleting deployment:", error);
            throw error;
          });
    }

    public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<void> {
        const deploymentId: string = deployment.id;
        if (!deploymentId) throw new Error("No deployment id");
    
        return this.setupPromise
          .then(() => {
            // Update deployment details in the database
            return this.sequelize.models[MODELS.DEPLOYMENT].update(deployment, {
              where: { id: deploymentId, appId: appId },
            });
          })
          .catch((error) => {
            console.error("Error updating deployment:", error);
            throw error;
          });
    }
    
    
    public commitPackage(accountId: string, appId: string, deploymentId: string, appPackage: storage.Package): q.Promise<storage.Package> {
        if (!deploymentId) throw new Error("No deployment id");
        if (!appPackage) throw new Error("No package specified");
    
        let packageHistory: storage.Package[];
        return this.setupPromise
          .then(() => {
            // Fetch the package history from S3
            return this.getPackageHistoryFromBlob(deploymentId);
          })
          .then((history: storage.Package[]) => {
            packageHistory = history;
            appPackage.label = this.getNextLabel(packageHistory);
            return this.getAccount(accountId);
          })
          .then((account: storage.Account) => {
            appPackage.releasedBy = account.email;
    
            // Remove the rollout value for the last package.
            const lastPackage: storage.Package = packageHistory.length ? packageHistory[packageHistory.length - 1] : null;
            if (lastPackage) {
              lastPackage.rollout = null;
            }
    
            packageHistory.push(appPackage);
    
            if (packageHistory.length > 100) { // Define your max history length
              packageHistory.splice(0, packageHistory.length - 100);
            }
    
            // Update deployment with the new package information
            return this.sequelize.models[MODELS.DEPLOYMENT].update({
              package: JSON.stringify(appPackage),
            }, {
              where: { id: deploymentId, appId: appId },
            });
          })
          .then(() => {
            // Upload updated package history to S3
            return this.uploadToHistoryBlob(deploymentId, JSON.stringify(packageHistory));
          })
          .then(() => appPackage)
          .catch((error) => {
            console.error("Error committing package:", error);
            throw error;
          });
    }
    public clearPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
        return this.setupPromise
          .then(() => {
            // Clear the package from the deployment
            return this.sequelize.models[MODELS.DEPLOYMENT].update({
              package: null,
            }, {
              where: { id: deploymentId, appId: appId },
            });
          })
          .then(() => {
            // Clear the package history in S3
            return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
          })
          .catch((error) => {
            console.error("Error clearing package history:", error);
            throw error;
          });
    }
    public getPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Package[]> {
      return this.setupPromise
        .then(() => {
          // Fetch all packages associated with the deploymentId, ordered by uploadTime
          return this.sequelize.models[MODELS.PACKAGE].findAll({
            where: { deploymentId: deploymentId },
            order: [['uploadTime', 'ASC']], // Sort by upload time to maintain historical order
          });
        })
        .then((packageRecords: any[]) => {
          // Map each package record to the storage.Package format
          return packageRecords.map((pkgRecord) => this.formatPackage(pkgRecord.dataValues));
        })
        .catch((error) => {
          console.error("Error retrieving package history:", error);
          throw error;
        });
    }
    

    public updatePackageHistory(accountId: string, appId: string, deploymentId: string, history: storage.Package[]): q.Promise<void> {
        if (!history || !history.length) {
          throw new Error("Cannot clear package history from an update operation");
        }
    
        return this.setupPromise
          .then(() => {
            // Update the deployment's package with the latest package from the history
            return this.sequelize.models[MODELS.DEPLOYMENT].update({
              package: JSON.stringify(history[history.length - 1]),
            }, {
              where: { id: deploymentId, appId: appId },
            });
          })
          .then(() => {
            // Upload the updated package history to S3
            return this.uploadToHistoryBlob(deploymentId, JSON.stringify(history));
          })
          .catch((error) => {
            console.error("Error updating package history:", error);
            throw error;
          });
    }

    //blobs
    public addBlob(blobId: string, stream: stream.Readable, streamLength: number): q.Promise<string> {
        return this.setupPromise
          .then(() => {
            // Convert the stream to a buffer
            return utils.streamToBuffer(stream);
          })
          .then((buffer) => {
            // Upload the buffer to S3
            return this.s3.putObject({
              Bucket: this.bucketName,
              Key: blobId,
              Body: buffer,
            }).promise();
          })
          .then(() => blobId)
          .catch((error) => {
            console.error("Error adding blob:", error);
            throw error;
          });
    }

    public getBlobUrl(blobId: string): q.Promise<string> {
        return this.setupPromise
          .then(() => {
            // Get the signed URL from S3
            return this.s3.getSignedUrlPromise('getObject', {
              Bucket: this.bucketName,
              Key: blobId,
              Expires: 60 * 60, // URL valid for 1 hour
            });
          })
          .catch((error) => {
            console.error("Error getting blob URL:", error);
            throw error;
          });
    }


    public removeBlob(blobId: string): q.Promise<void> {
        return this.setupPromise
          .then(() => {
            // Delete the blob from S3
            return this.s3.deleteObject({
              Bucket: this.bucketName,
              Key: blobId,
            }).promise();
          })
          .catch((error) => {
            console.error("Error removing blob:", error);
            throw error;
          });
    }
       

    public getPackageHistoryFromDeploymentKey(deploymentKey: string): q.Promise<storage.Package[]> {
        return this.setupPromise
          .then(() => {
            return this.getDeploymentInfo(deploymentKey);
          })
          .then((deploymentInfo: storage.DeploymentInfo) => {
            // Fetch package history from S3
            return this.getPackageHistoryFromBlob(deploymentInfo.deploymentId);
          })
          .catch(S3Storage.storageErrorHandler);
    }

    private getPackageHistoryFromBlob(deploymentId: string): q.Promise<storage.Package[]> {
        const deferred = q.defer<storage.Package[]>();
    
        // Use AWS SDK to download the blob from S3
        this.s3
          .getObject({ Bucket: this.bucketName, Key: `${deploymentId}/history.json` })
          .promise()
          .then((data) => {
            const packageHistory = JSON.parse(data.Body.toString());
            deferred.resolve(packageHistory);
          })
          .catch((error) => {
            deferred.reject(error);
          });
    
        return deferred.promise;
    }

    //blob utility methods
    private deleteHistoryBlob(blobId: string): q.Promise<void> {
        const deferred = q.defer<void>();
    
        this.s3
          .deleteObject({
            Bucket: this.bucketName,  // Your S3 bucket name
            Key: blobId               // The blob (file) ID to be deleted
          })
          .promise()
          .then(() => {
            deferred.resolve();
          })
          .catch((error: any) => {
            deferred.reject(error);
          });
    
        return deferred.promise;
    }
    

    private uploadToHistoryBlob(deploymentId: string, content: string): q.Promise<void> {
        const deferred = q.defer<void>();
    
        this.s3
          .putObject({
            Bucket: this.bucketName,
            Key: `${deploymentId}/history.json`,
            Body: content,
            ContentType: "application/json",
          })
          .promise()
          .then(() => {
            deferred.resolve();
          })
          .catch((error) => {
            deferred.reject(error);
          });
    
        return deferred.promise;
    }


    //Access Key Conformation
    public addAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<string> {
        accessKey.id = shortid.generate();
        return this.setupPromise
          .then(() => {
            // Insert the access key into the database
            return this.sequelize.models[MODELS.ACCESSKEY].create({ ...accessKey, accountId });
          })
          .then(() => {
            return accessKey.id;
          });
    }


    public getAccessKey(accountId: string, accessKeyId: string): q.Promise<storage.AccessKey> {
        return this.setupPromise
          .then(() => {
            // Find the access key in the database using Sequelize
            return this.sequelize.models.AccessKey.findOne({
              where: {
                accountId: accountId,
                id: accessKeyId,
              },
            });
          })
          .then((accessKey: any) => {
            if (!accessKey) {
              throw new Error("Access key not found");
            }
            return accessKey.dataValues; // Return the access key data
          })
          .catch((error: any) => {
            console.error("Error retrieving access key:", error);
            throw error;
          });
    }

    public removeAccessKey(accountId: string, accessKeyId: string): q.Promise<void> {
        return this.setupPromise
          .then(() => {
            // First, retrieve the access key
            return this.getAccessKey(accountId, accessKeyId);
          })
          .then((accessKey) => {
            if (!accessKey) {
              throw new Error("Access key not found");
            }
    
            // Remove the access key from the database
            return this.sequelize.models.AccessKey.destroy({
              where: {
                accountId: accountId,
                id: accessKeyId,
              },
            });
          })
          .then(() => {
            console.log("Access key removed successfully");
          })
          .catch((error: any) => {
            console.error("Error removing access key:", error);
            throw error;
          });
    }

    public updateAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<void> {
        if (!accessKey) {
          throw new Error("No access key provided");
        }
    
        if (!accessKey.id) {
          throw new Error("No access key ID provided");
        }
    
        return this.setupPromise
          .then(() => {
            // Update the access key in the database
            return this.sequelize.models.AccessKey.update(accessKey, {
              where: {
                accountId: accountId,
                id: accessKey.id,
              },
            });
          })
          .then(() => {
            console.log("Access key updated successfully");
          })
          .catch((error: any) => {
            console.error("Error updating access key:", error);
            throw error;
          });
    }
    
    
    

    public getAccessKeys(accountId: string): q.Promise<storage.AccessKey[]> {
        return this.setupPromise
          .then(() => {
            // Retrieve all access keys for the account
            return this.sequelize.models[MODELS.ACCESSKEY].findAll({ where: { accountId } });
          })
          .then((accessKeys: any[]) => {
            return accessKeys.map((accessKey: any) => accessKey.dataValues);
          });
    }
    public getDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Deployment> {
        return this.setupPromise
          .then(() => {
            // Fetch the deployment by appId and deploymentId using Sequelize
            return this.retrieveByAppHierarchy(appId, deploymentId);
          })
          .then((flatDeployment: any) => {
            // Convert the retrieved Sequelize object to the desired format
            return this.unflattenDeployment(flatDeployment);
          })
          .catch((error) => {
            // Handle any Sequelize errors here
            console.error("Error fetching deployment:", error);
            throw error;
          });
    }

    private unflattenDeployment(flatDeployment: any): storage.Deployment {
        if (!flatDeployment) throw new Error("Deployment not found");
    
        // Parse the package field if it's stored as a JSON string in the DB
        flatDeployment.package = flatDeployment.package ? JSON.parse(flatDeployment.package) : null;
    
        // Return the unflattened deployment
        return flatDeployment;
    }

    private async attachPackageToDeployment(accounId: string, flatDeployment: any): Promise<storage.Deployment> {
      if (!flatDeployment) throw new Error("Deployment not found");
    
      // Retrieve the package details from the Package table using packageId
      let packageData: storage.Package | null = null;
      let packageHistory: storage.Package[] = [];
    
      if (flatDeployment.packageId) {
        const packageRecord = await this.sequelize.models[MODELS.PACKAGE].findOne({
          where: { id: flatDeployment.packageId },
        });
    
        if (packageRecord) {
          packageData = this.formatPackage(packageRecord.dataValues); // Format to match storage.Package interface
        }
      }

      packageHistory = await this.getPackageHistory(accounId, flatDeployment.appId, flatDeployment.id);
    
      // Construct and return the full deployment object
      return {
        id: flatDeployment.id,
        name: flatDeployment.name,
        key: flatDeployment.key,
        package: packageData, // Include the resolved package data
        packageHistory: packageHistory,
      };
    }
    
    // Helper function to format package data to storage.Package
    private formatPackage(pkgData: any): storage.Package | null {
      if (!pkgData) return null;
    
      return {
        appVersion: pkgData.appVersion,
        blobUrl: pkgData.blobUrl,
        description: pkgData.description,
        diffPackageMap: pkgData.diffPackageMap ? JSON.parse(pkgData.diffPackageMap) : undefined,
        isDisabled: pkgData.isDisabled,
        isMandatory: pkgData.isMandatory,
        label: pkgData.label,
        manifestBlobUrl: pkgData.manifestBlobUrl,
        originalDeployment: pkgData.originalDeployment,
        originalLabel: pkgData.originalLabel,
        packageHash: pkgData.packageHash,
        releasedBy: pkgData.releasedBy,
        releaseMethod: pkgData.releaseMethod,
        rollout: pkgData.rollout,
        size: pkgData.size,
        uploadTime: pkgData.uploadTime,
      };
    }
    
    private retrieveByAppHierarchy(appId: string, deploymentId: string): q.Promise<any> {
        return q(
          this.sequelize.models[MODELS.DEPLOYMENT].findOne({
            where: {
              appId: appId,
              id: deploymentId, // Assuming 'id' is the deploymentId
            },
            include: [{
              model: this.sequelize.models.Package, // Eager load the associated package
              as: 'package', // Alias for the associated model if needed
            }]
          })
        );
    }
    
    
    
    

    // No-op for safety, so that we don't drop the wrong db, pending a cleaner solution for removing test data.
    public dropAll(): q.Promise<void> {
      return q(<void>null);
    }
  

    private async getCollabrators(app:storage.App, accountId) {
      const collabModel = await this.sequelize.models[MODELS.COLLABORATOR].findAll({where : {appId: app.id}})
      const collabMap = {}
      collabModel.map((collab) => {
        collabMap[collab.dataValues["email"]] = {
          ...collab.dataValues,
          "isCurrentAccount" : false
        }
      })
      const currentUserEmail: string = S3Storage.getEmailForAccountId(collabMap, accountId);
      if (currentUserEmail && collabMap[currentUserEmail]) {
        collabMap[currentUserEmail].isCurrentAccount = true;
      }
      app["collaborators"] = collabMap
      return app;
    }

    

    public updateAppWithPermission(accountId: string, app: any, updateCollaborator: boolean = false): q.Promise<void> {
        const appId: string = app.id;
        if (!appId) throw new Error("No app id");
    
        const flatApp = this.flattenAppForSequelize(app, updateCollaborator);
    
        // Start a transaction since we may be updating multiple tables (app + collaborators)
        return this.setupPromise
            .then(() => {
                return this.sequelize.transaction((t) => {
                    // Update the App in the database
                    return this.sequelize.models[MODELS.APPS].update(flatApp, {
                        where: { id: appId },
                        transaction: t,
                    }).then(() => {
                        if (updateCollaborator && app.collaborators) {
                            // Remove 'isCurrentAccount' flag before updating collaborators
                            this.deleteIsCurrentAccountProperty(app.collaborators);
    
                            // First, remove existing collaborators for this app
                            return this.sequelize.models[MODELS.COLLABORATOR].destroy({
                                where: { appId: appId },
                                transaction: t,
                            }).then(() => {
                                // Then, add updated collaborators
                                const collaborators = Object.keys(app.collaborators).map((email) => {
                                    const collaborator = app.collaborators[email];
                                    return {
                                        email,
                                        accountId: collaborator.accountId,
                                        appId: appId,
                                        permission: collaborator.permission,
                                    };
                                });
    
                                // Add updated collaborators
                                return this.sequelize.models[MODELS.COLLABORATOR].bulkCreate(collaborators, { transaction: t }).then(() => {
                                    // Explicitly return void to satisfy the function's return type
                                    return;
                                });
                            });
                        } else {
                            // No collaborator update, just resolve the promise
                            return;
                        }
                    });
                });
            });
    }
    

    private flattenAppForSequelize(app: any, updateCollaborator: boolean = false): any {
        if (!app) {
            return app;
        }
    
        const flatApp: any = {};
        for (const property in app) {
            if (property === "collaborators" && updateCollaborator) {
                this.deleteIsCurrentAccountProperty(app.collaborators); // Remove unnecessary properties from collaborators
            } else if (property !== "collaborators") {
                flatApp[property] = app[property];  // Copy all other properties
            }
        }
    
        return flatApp;
    }

    private getNextLabel(packageHistory: storage.Package[]): string {
        if (packageHistory.length === 0) {
          return "v1";
        }
    
        const lastLabel: string = packageHistory[packageHistory.length - 1].label;
        const lastVersion: number = parseInt(lastLabel.substring(1)); // Trim 'v' from the front
        return "v" + (lastVersion + 1);
      }
    

    private deleteIsCurrentAccountProperty(map: any): void {
        if (map) {
            Object.keys(map).forEach((key: string) => {
                delete map[key].isCurrentAccount;
            });
        }
    }
    

  
    private static storageErrorHandler(
      azureError: any,
      overrideMessage: boolean = false,
      overrideCondition?: string,
      overrideValue?: string
    ): any {
      let errorCodeRaw: number | string;
      let errorMessage: string;
  
      try {
        const parsedMessage = JSON.parse(azureError.message);
        errorCodeRaw = parsedMessage["odata.error"].code;
        errorMessage = parsedMessage["odata.error"].message.value;
      } catch (error) {
        errorCodeRaw = azureError.code;
        errorMessage = azureError.message;
      }
  
      if (overrideMessage && overrideCondition == errorCodeRaw) {
        errorMessage = overrideValue;
      }
  
      if (typeof errorCodeRaw === "number") {
        // This is a storage.Error that we previously threw; just re-throw it
        throw azureError;
      }
  
      let errorCode: storage.ErrorCode;
      switch (errorCodeRaw) {
        case "BlobNotFound":
        case "ResourceNotFound":
        case "TableNotFound":
          errorCode = storage.ErrorCode.NotFound;
          break;
        case "EntityAlreadyExists":
        case "TableAlreadyExists":
          errorCode = storage.ErrorCode.AlreadyExists;
          break;
        case "EntityTooLarge":
        case "PropertyValueTooLarge":
          errorCode = storage.ErrorCode.TooLarge;
          break;
        case "ETIMEDOUT":
        case "ESOCKETTIMEDOUT":
        case "ECONNRESET":
          // This is an error emitted from the 'request' module, which is a
          // dependency of 'azure-storage', and indicates failure after multiple
          // retries.
          errorCode = storage.ErrorCode.ConnectionFailed;
          break;
        default:
          errorCode = storage.ErrorCode.Other;
          break;
      }
      throw storage.storageError(errorCode, errorMessage);
    }
  
    private static getEmailForAccountId(collaboratorsMap: storage.CollaboratorMap, accountId: string): string {
      if (collaboratorsMap) {
        for (const email of Object.keys(collaboratorsMap)) {
          if ((<storage.CollaboratorProperties>collaboratorsMap[email]).accountId === accountId) {
            return email;
          }
        }
      }
  
      return null;
    }
  }