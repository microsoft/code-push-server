import * as q from "q";
import { App, Storage } from "../storage";
import { Sequelize } from "sequelize";

// import * as q from "q";
import * as shortid from "shortid";
import * as stream from "stream";
import * as storage from "../storage";
import { createModels, MODELS } from "./models/model";


const DB_NAME = "codepushdb"
const DB_USER_NAME = "codepush"
const DB_PASS = "root"
const DB_HOST = "localhost"

export class S3Storage implements Storage {
    private static BUCKET_NAME = "beta-moving-tech-assets"
    private sequelize:Sequelize;
    private setupPromise: q.Promise<void>
    public constructor() {
        shortid.characters("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-");
        this.sequelize = new Sequelize(process.env["DB_NAME"] || DB_NAME, process.env["DB_USER_NAME"] || DB_USER_NAME, process.env["DB_PASS"] || DB_PASS, {
            host: process.env["DB_HOST"] || DB_HOST,
            dialect: 'postgres'
          });
        this.setupPromise = this.setup()
          
    }

    private setup():q.Promise<void> {
      return q.all([
          this.sequelize.authenticate(),
          createModels(this.sequelize)
      ]).then(() => {
        this.sequelize.sync()
      })
    }

    public reinitialize(): q.Promise<void> {
      console.log("Re-initializing Azure storage");
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
          .catch(S3Storage.azureErrorHandler);
      }
  
    public getAccount(accountId: string): q.Promise<storage.Account> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.ACCOUNT].findByPk(accountId)
        })
        .then((acoount) => {
          return acoount.dataValues
        })
        .catch(S3Storage.azureErrorHandler);
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
        .catch(S3Storage.azureErrorHandler);
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
        .catch(S3Storage.azureErrorHandler);
    }
  
    public addApp(accountId: string, app: storage.App): q.Promise<storage.App> {
      app = storage.clone(app); // pass by value
      app.id = shortid.generate();
  
      return this.setupPromise
        .then(() => {
          return this.getAccount(accountId);
        })
        .then(async (account: storage.Account) => {
          const collabMap = { email: account.email, accountId: accountId, permission: storage.Permissions.Owner, appId :app.id };
          await this.sequelize.models[MODELS.COLLABORATOR].findOrCreate({
            where : { appId: app.id , email: account.email},
            defaults: {...collabMap}})
          const updatedApp = {
            ...app
            ,"accountId": accountId
          }
          if (updatedApp.collaborators) {
            delete updatedApp.collaborators;
          }
          const addApp = this.sequelize.models[MODELS.APPS].findOrCreate({
            where : { name: app.name},
            defaults : {
              
            }
          })
          return addApp
        })
        .then(() => {
          return app;
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public getApps(accountId: string): q.Promise<storage.App[]> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.APPS].findAll({where : {
            accountId: accountId
          }});
        })
        .then(async (flatAppsModel) => {
          const flatApps = flatAppsModel.map (val => val.dataValues)
          const apps = [];
          for (let i = 0; i< flatApps.length; i++) {
            const updatedApp = await this.getCollabrators(flatApps[i],accountId)
            apps.push(updatedApp);
          }
          return apps;
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public getApp(accountId: string, appId: string, keepCollaboratorIds: boolean = false): q.Promise<storage.App> {
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.APPS].findByPk(appId).then((flatAppModel) => {
            return this.getCollabrators(flatAppModel.dataValues,accountId);
          });
        })
        .then((app) => {
          return app; 
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public removeApp(accountId: string, appId: string): q.Promise<void> {
      // remove entries for all collaborators account before removing the app
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.COLLABORATOR].destroy({
            where :{appId : appId, accountId: accountId}
          })
        })
        .then(() => {
          return this.sequelize.models[MODELS.APPS].destroy({
            where :{id : appId, accountId: accountId}
          })
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public updateApp(accountId: string, app: storage.App): q.Promise<void> {
      const appId: string = app.id;
      if (!appId) throw new Error("No app id");
  
      return this.setupPromise
        .then(() => {
          return this.updateAppWithPermission(accountId,app,true)
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public transferApp(accountId: string, appId: string, email: string): q.Promise<void> {
      // let app: storage.App;
      // let targetCollaboratorAccountId: string;
      // let requestingCollaboratorEmail: string;
      // let isTargetAlreadyCollaborator: boolean;
  
      // return this.setupPromise
      //   .then(() => {
      //     const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
      //     const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
      //     return q.all<any>([getAppPromise, accountPromise]);
      //   })
      //   .spread((appPromiseResult: storage.App, accountPromiseResult: storage.Account) => {
      //     targetCollaboratorAccountId = accountPromiseResult.id;
      //     email = accountPromiseResult.email; // Use the original email stored on the account to ensure casing is consistent
      //     app = appPromiseResult;
      //     requestingCollaboratorEmail = S3Storage.getEmailForAccountId(app.collaborators, accountId);
  
      //     if (requestingCollaboratorEmail === email) {
      //       throw storage.storageError(storage.ErrorCode.AlreadyExists, "The given account already owns the app.");
      //     }
  
      //     return this.getApps(targetCollaboratorAccountId);
      //   })
      //   .then((appsForCollaborator: storage.App[]) => {
      //     if (storage.NameResolver.isDuplicate(appsForCollaborator, app.name)) {
      //       throw storage.storageError(
      //         storage.ErrorCode.AlreadyExists,
      //         'Cannot transfer ownership. An app with name "' + app.name + '" already exists for the given collaborator.'
      //       );
      //     }
  
      //     isTargetAlreadyCollaborator = S3Storage.isCollaborator(app.collaborators, email);
  
      //     // Update the current owner to be a collaborator
      //     S3Storage.setCollaboratorPermission(app.collaborators, requestingCollaboratorEmail, storage.Permissions.Collaborator);
  
      //     // set target collaborator as an owner.
      //     if (isTargetAlreadyCollaborator) {
      //       S3Storage.setCollaboratorPermission(app.collaborators, email, storage.Permissions.Owner);
      //     } else {
      //       const targetOwnerProperties: storage.CollaboratorProperties = {
      //         accountId: targetCollaboratorAccountId,
      //         permission: storage.Permissions.Owner,
      //       };
      //       S3Storage.addToCollaborators(app.collaborators, email, targetOwnerProperties);
      //     }
  
      //     return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true);
      //   })
      //   .then(() => {
      //     if (!isTargetAlreadyCollaborator) {
      //       // Added a new collaborator as owner to the app, create a corresponding entry for app in target collaborator's account.
      //       return this.addAppPointer(targetCollaboratorAccountId, app.id);
      //     }
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public addCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
      //     const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
      //     return q.all<any>([getAppPromise, accountPromise]);
      //   })
      //   .spread((app: storage.App, account: storage.Account) => {
      //     // Use the original email stored on the account to ensure casing is consistent
      //     email = account.email;
      //     return this.addCollaboratorWithPermissions(accountId, app, email, {
      //       accountId: account.id,
      //       permission: storage.Permissions.Collaborator,
      //     });
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getCollaborators(accountId: string, appId: string): q.Promise<storage.CollaboratorMap> {
      return this.setupPromise
        .then(() => {
          return this.getApp(accountId, appId, /*keepCollaboratorIds*/ false);
        })
        .then((app: storage.App) => {
          return q<storage.CollaboratorMap>(app.collaborators);
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public removeCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
      //   })
      //   .then((app: storage.App) => {
      //     const removedCollabProperties: storage.CollaboratorProperties = app.collaborators[email];
  
      //     if (!removedCollabProperties) {
      //       throw storage.storageError(storage.ErrorCode.NotFound, "The given email is not a collaborator for this app.");
      //     }
  
      //     if (!S3Storage.isOwner(app.collaborators, email)) {
      //       delete app.collaborators[email];
      //     } else {
      //       throw storage.storageError(storage.ErrorCode.AlreadyExists, "Cannot remove the owner of the app from collaborator list.");
      //     }
  
      //     return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true).then(() => {
      //       return this.removeAppPointer(removedCollabProperties.accountId, app.id);
      //     });
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<string> {
      // let deploymentId: string;
      // return this.setupPromise
      //   .then(() => {
      //     const flatDeployment: any = S3Storage.flattenDeployment(deployment);
      //     flatDeployment.id = shortid.generate();
  
      //     return this.insertByAppHierarchy(flatDeployment, appId, flatDeployment.id);
      //   })
      //   .then((returnedId: string) => {
      //     deploymentId = returnedId;
      //     return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
      //   })
      //   .then(() => {
      //     const shortcutPartitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deployment.key);
      //     const shortcutRowKey: string = Keys.getShortcutDeploymentKeyRowKey();
      //     const pointer: DeploymentKeyPointer = {
      //       appId: appId,
      //       deploymentId: deploymentId,
      //     };
  
      //     const entity: any = this.wrap(pointer, shortcutPartitionKey, shortcutRowKey);
      //     return this._tableClient.createEntity(entity);
      //   })
      //   .then(() => {
      //     return deploymentId;
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getDeploymentInfo(deploymentKey: string): q.Promise<storage.DeploymentInfo> {
      // const partitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deploymentKey);
      // const rowKey: string = Keys.getShortcutDeploymentKeyRowKey();
  
      // return this.setupPromise
      //   .then(() => {
      //     return this.retrieveByKey(partitionKey, rowKey);
      //   })
      //   .then((pointer: DeploymentKeyPointer): storage.DeploymentInfo => {
      //     if (!pointer) {
      //       return null;
      //     }
  
      //     return { appId: pointer.appId, deploymentId: pointer.deploymentId };
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getPackageHistoryFromDeploymentKey(deploymentKey: string): q.Promise<storage.Package[]> {
      // const pointerPartitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deploymentKey);
      // const pointerRowKey: string = Keys.getShortcutDeploymentKeyRowKey();
  
      // return this.setupPromise
      //   .then(() => {
      //     return this.retrieveByKey(pointerPartitionKey, pointerRowKey);
      //   })
      //   .then((pointer: DeploymentKeyPointer) => {
      //     if (!pointer) return null;
  
      //     return this.getPackageHistoryFromBlob(pointer.deploymentId);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Deployment> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.retrieveByAppHierarchy(appId, deploymentId);
      //   })
      //   .then((flatDeployment: any) => {
      //     return S3Storage.unflattenDeployment(flatDeployment);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getDeployments(accountId: string, appId: string): q.Promise<storage.Deployment[]> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.getCollectionByHierarchy(accountId, appId);
      //   })
      //   .then((flatDeployments: any[]) => {
      //     const deployments: storage.Deployment[] = [];
      //     flatDeployments.forEach((flatDeployment: any) => {
      //       deployments.push(S3Storage.unflattenDeployment(flatDeployment));
      //     });
  
      //     return deployments;
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public removeDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.cleanUpByAppHierarchy(appId, deploymentId);
      //   })
      //   .then(() => {
      //     return this.deleteHistoryBlob(deploymentId);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<void> {
      // const deploymentId: string = deployment.id;
      // if (!deploymentId) throw new Error("No deployment id");
  
      // return this.setupPromise
      //   .then(() => {
      //     const flatDeployment: any = S3Storage.flattenDeployment(deployment);
      //     return this.mergeByAppHierarchy(flatDeployment, appId, deploymentId);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public commitPackage(
      accountId: string,
      appId: string,
      deploymentId: string,
      appPackage: storage.Package
    ): q.Promise<storage.Package> {
      // if (!deploymentId) throw new Error("No deployment id");
      // if (!appPackage) throw new Error("No package specified");
  
      // appPackage = storage.clone(appPackage); // pass by value
  
      // let packageHistory: storage.Package[];
      // return this.setupPromise
      //   .then(() => {
      //     return this.getPackageHistoryFromBlob(deploymentId);
      //   })
      //   .then((history: storage.Package[]) => {
      //     packageHistory = history;
      //     appPackage.label = this.getNextLabel(packageHistory);
      //     return this.getAccount(accountId);
      //   })
      //   .then((account: storage.Account) => {
      //     appPackage.releasedBy = account.email;
  
      //     // Remove the rollout value for the last package.
      //     const lastPackage: storage.Package =
      //       packageHistory && packageHistory.length ? packageHistory[packageHistory.length - 1] : null;
      //     if (lastPackage) {
      //       lastPackage.rollout = null;
      //     }
  
      //     packageHistory.push(appPackage);
  
      //     if (packageHistory.length > S3Storage.MAX_PACKAGE_HISTORY_LENGTH) {
      //       packageHistory.splice(0, packageHistory.length - S3Storage.MAX_PACKAGE_HISTORY_LENGTH);
      //     }
  
      //     const flatPackage: any = { id: deploymentId, package: JSON.stringify(appPackage) };
      //     return this.mergeByAppHierarchy(flatPackage, appId, deploymentId);
      //   })
      //   .then(() => {
      //     return this.uploadToHistoryBlob(deploymentId, JSON.stringify(packageHistory));
      //   })
      //   .then((): storage.Package => {
      //     return appPackage;
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public clearPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.retrieveByAppHierarchy(appId, deploymentId);
      //   })
      //   .then((flatDeployment: any) => {
      //     delete flatDeployment.package;
      //     return this.updateByAppHierarchy(flatDeployment, appId, deploymentId);
      //   })
      //   .then(() => {
      //     return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Package[]> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.getPackageHistoryFromBlob(deploymentId);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public updatePackageHistory(accountId: string, appId: string, deploymentId: string, history: storage.Package[]): q.Promise<void> {
      // If history is null or empty array we do not update the package history, use clearPackageHistory for that.
      // if (!history || !history.length) {
      //   throw storage.storageError(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
      // }
  
      // return this.setupPromise
      //   .then(() => {
      //     const flatDeployment: any = { id: deploymentId, package: JSON.stringify(history[history.length - 1]) };
      //     return this.mergeByAppHierarchy(flatDeployment, appId, deploymentId);
      //   })
      //   .then(() => {
      //     return this.uploadToHistoryBlob(deploymentId, JSON.stringify(history));
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public addBlob(blobId: string, stream: stream.Readable, streamLength: number): q.Promise<string> {
      // return this.setupPromise
      //   .then(() => {
      //     return utils.streamToBuffer(stream);
      //   })
      //   .then((buffer) => {
      //     return this._blobService.getContainerClient(S3Storage.TABLE_NAME).uploadBlockBlob(blobId, buffer, buffer.byteLength);
      //   })
      //   .then(() => {
      //     return blobId;
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getBlobUrl(blobId: string): q.Promise<string> {
      // return this.setupPromise
      //   .then(() => {
      //     return this._blobService.getContainerClient(S3Storage.TABLE_NAME).getBlobClient(blobId).url;
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public removeBlob(blobId: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     return this._blobService.getContainerClient(S3Storage.TABLE_NAME).deleteBlob(blobId);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public addAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<string> {
      accessKey = storage.clone(accessKey); // pass by value
      accessKey.id = shortid.generate();
  
      return this.setupPromise
        .then(() => {
          return this.sequelize.models[MODELS.ACCESSKEY].findOrCreate({
            where: {id :accessKey.id}, defaults: {
              ...accessKey,
              "accountId" : accountId
          }
        })
        })
        .then((): string => {
          return accessKey.id;
        })
        .catch(S3Storage.azureErrorHandler);
    }
  
    public getAccessKey(accountId: string, accessKeyId: string): q.Promise<storage.AccessKey> {
      // const partitionKey: string = Keys.getAccountPartitionKey(accountId);
      // const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKeyId);
      // return this.setupPromise
      //   .then(() => {
      //     return this.retrieveByKey(partitionKey, rowKey);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public getAccessKeys(accountId: string): q.Promise<storage.AccessKey[]> {
      const deferred = q.defer<storage.AccessKey[]>();
  
      // const partitionKey: string = Keys.getAccountPartitionKey(accountId);
      // const rowKey: string = Keys.getHierarchicalAccountRowKey(accountId);
      // const searchKey: string = Keys.getAccessKeyRowKey(accountId);
  
      // // Fetch both the parent account (for error-checking purposes) and the access tokens
      // const query = `PartitionKey eq '${partitionKey}' and (RowKey eq '${rowKey}' or (RowKey gt '${searchKey}' and RowKey lt '${searchKey}~'))`;
      // const options = { queryOptions: { filter: query } };
  
      this.setupPromise.then(() => {
        this.sequelize.models[MODELS.ACCESSKEY].findAll({
          where: {
            "accountId": accountId
          }
        }).then((accessKeys) => {
          const keys = accessKeys.map(val => val.dataValues);
          deferred.resolve(keys)
        })
          .catch((error: any) => {
            deferred.reject(error);
          });
      });
  
      return deferred.promise;
    }
  
    public removeAccessKey(accountId: string, accessKeyId: string): q.Promise<void> {
      // return this.setupPromise
      //   .then(() => {
      //     return this.getAccessKey(accountId, accessKeyId);
      //   })
      //   .then((accessKey) => {
      //     const partitionKey: string = Keys.getAccountPartitionKey(accountId);
      //     const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKeyId);
      //     const shortcutAccessKeyPartitionKey: string = Keys.getShortcutAccessKeyPartitionKey(accessKey.name, false);
  
      //     return q.all<any>([
      //       this._tableClient.deleteEntity(partitionKey, rowKey),
      //       this._tableClient.deleteEntity(shortcutAccessKeyPartitionKey, ""),
      //     ]);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    public updateAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<void> {
      // if (!accessKey) {
      //   throw new Error("No access key");
      // }
  
      // if (!accessKey.id) {
      //   throw new Error("No access key id");
      // }
  
      // const partitionKey: string = Keys.getAccountPartitionKey(accountId);
      // const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKey.id);
  
      // return this.setupPromise
      //   .then(() => {
      //     const entity: any = this.wrap(accessKey, partitionKey, rowKey);
      //     return this._tableClient.updateEntity(entity);
      //   })
      //   .then(() => {
      //     const newAccessKeyPointer: AccessKeyPointer = {
      //       accountId,
      //       expires: accessKey.expires,
      //     };
  
      //     const accessKeyPointerEntity: any = this.wrap(
      //       newAccessKeyPointer,
      //       Keys.getShortcutAccessKeyPartitionKey(accessKey.name, false),
      //       ""
      //     );
      //     return this._tableClient.updateEntity(accessKeyPointerEntity);
      //   })
      //   .catch(S3Storage.azureErrorHandler);
    }
  
    // No-op for safety, so that we don't drop the wrong db, pending a cleaner solution for removing test data.
    public dropAll(): q.Promise<void> {
      return q(<void>null);
    }
  
    // private setup(accountName?: string, accountKey?: string): q.Promise<void> {
    //   let tableServiceClient: TableServiceClient;
    //   let tableClient: TableClient;
    //   let blobServiceClient: BlobServiceClient;
  
    //   if (process.env.EMULATED) {
    //     const devConnectionString = "UseDevelopmentStorage=true";
  
    //     tableServiceClient = TableServiceClient.fromConnectionString(devConnectionString);
    //     tableClient = TableClient.fromConnectionString(devConnectionString, S3Storage.TABLE_NAME);
    //     blobServiceClient = BlobServiceClient.fromConnectionString(devConnectionString);
    //   } else {
    //     if ((!accountName && !process.env.AZURE_STORAGE_ACCOUNT) || (!accountKey && !process.env.AZURE_STORAGE_ACCESS_KEY)) {
    //       throw new Error("Azure credentials not set");
    //     }
  
    //     const _accountName = accountName ?? process.env.AZURE_STORAGE_ACCOUNT;
    //     const _accountKey = accountKey ?? process.env.AZURE_STORAGE_ACCESS_KEY;
  
    //     const tableStorageCredential = new AzureNamedKeyCredential(_accountName, _accountKey);
    //     const blobStorageCredential = new StorageSharedKeyCredential(_accountName, _accountKey);
  
    //     const tableServiceUrl = `https://${_accountName}.table.core.windows.net`;
    //     const blobServiceUrl = `https://${_accountName}.blob.core.windows.net`;
  
    //     tableServiceClient = new TableServiceClient(tableServiceUrl, tableStorageCredential, {
    //       retryOptions: {
    //         maxRetries: 3,
    //         maxRetryDelayInMs: 2000,
    //         retryDelayInMs: 500,
    //       },
    //     });
    //     tableClient = new TableClient(tableServiceUrl, S3Storage.TABLE_NAME, tableStorageCredential);
    //     blobServiceClient = new BlobServiceClient(blobServiceUrl, blobStorageCredential, {
    //       retryOptions: {
    //         maxTries: 4,
    //         maxRetryDelayInMs: 2000,
    //         retryDelayInMs: 500,
    //       },
    //     });
    //   }
  
    //   const tableHealthEntity: any = this.wrap({ health: "health" }, /*partitionKey=*/ "health", /*rowKey=*/ "health");
  
    //   return q
    //     .all([
    //       tableServiceClient.createTable(S3Storage.TABLE_NAME),
    //       blobServiceClient.createContainer(S3Storage.TABLE_NAME, { access: "blob" }),
    //       blobServiceClient.createContainer(S3Storage.HISTORY_BLOB_CONTAINER_NAME),
    //     ])
    //     .then(() => {
    //       return q.all<any>([
    //         tableClient.createEntity(tableHealthEntity),
    //         blobServiceClient.getContainerClient(S3Storage.TABLE_NAME).uploadBlockBlob("health", "health", "health".length),
    //         blobServiceClient
    //           .getContainerClient(S3Storage.HISTORY_BLOB_CONTAINER_NAME)
    //           .uploadBlockBlob("health", "health", "health".length),
    //       ]);
    //     })
    //     .then(() => {
    //       // Do not assign these unless everything completes successfully, as this will cause in-flight promise chains to start using
    //       // the initialized services
    //       this._tableClient = tableClient;
    //       this._blobService = blobServiceClient;
    //     })
    //     .catch((error) => {
    //       if (error.code == "ContainerAlreadyExists") {
    //         this._tableClient = tableClient;
    //         this._blobService = blobServiceClient;
    //       } else {
    //         throw error;
    //       }
    //     });
    // }

    private async getCollabrators(app:App,accountId) {
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

    private async  updateAppWithPermission(accountId: string, app: storage.App, updateCollaborator: boolean = false) {
      const appId: string = app.id;
      if (!appId) throw new Error("No app id");

      if (updateCollaborator) {
        // TODO UPDATE COLLAB
      }
      return this.sequelize.models[MODELS.APPS].update({
        ...app
      },{
        where: {id:appId , accountId:accountId}
      })
    }

  
    private static azureErrorHandler(
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