// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";
import * as fs from "fs";
import * as http from "http";
import * as q from "q";
import * as stream from "stream";

import * as storage from "./storage";

import clone = storage.clone;
import Promise = q.Promise;
import { isPrototypePollutionKey } from "./storage";
import path = require("path");
import Redis from "ioredis";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function merge(original: any, updates: any): void {
  for (const property in updates) {
    original[property] = updates[property];
  }
}

export class RedisS3Storage implements storage.Storage {
  public static NextIdNumber: number = 0;
  public accounts: { [id: string]: storage.Account } = {};
  public apps: { [id: string]: storage.App } = {};
  public deployments: { [id: string]: storage.Deployment } = {};
  public packages: { [id: string]: storage.Package } = {};
  public blobs: { [id: string]: string } = {};
  public accessKeys: { [id: string]: storage.AccessKey } = {};
  public deploymentKeys: { [id: string]: string } = {};

  public accountToAppsMap: { [id: string]: string[] } = {};
  public appToAccountMap: { [id: string]: string } = {};
  public emailToAccountMap: { [email: string]: string } = {};

  public appToDeploymentsMap: { [id: string]: string[] } = {};
  public deploymentToAppMap: { [id: string]: string } = {};

  public deploymentKeyToDeploymentMap: { [id: string]: string } = {};

  public accountToAccessKeysMap: { [id: string]: string[] } = {};
  public accessKeyToAccountMap: { [id: string]: string } = {};

  public accessKeyNameToAccountIdMap: { [accessKeyName: string]: { accountId: string; expires: number } } = {};

  private static CollaboratorNotFound: string = "The specified e-mail address doesn't represent a registered user";
  private redisClient: Redis;
  private s3Client: S3Client;
  private _blobServerPromise: Promise<http.Server>;
  private updatesDir: string = path.join(__dirname, "updates");

  constructor() {
    this.redisClient = new Redis();
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS,
      },
    });
    if (!fs.existsSync(this.updatesDir)) {
      fs.mkdirSync(this.updatesDir);
    }
    this.loadStateAsync();
  }

  private loadStateAsync(): globalThis.Promise<void> {
    return this.redisClient.get("state").then((state) => {
      if (!state) {
        return;
      }
      const obj = JSON.parse(state);

      RedisS3Storage.NextIdNumber = obj.NextIdNumber || 0;
      this.accounts = obj.accounts || {};
      this.apps = obj.apps || {};
      this.deployments = obj.deployments || {};
      this.deploymentKeys = obj.deploymentKeys || {};
      this.blobs = obj.blobs || {};
      this.accountToAppsMap = obj.accountToAppsMap || {};
      this.appToAccountMap = obj.appToAccountMap || {};
      this.emailToAccountMap = obj.emailToAccountMap || {};
      this.appToDeploymentsMap = obj.appToDeploymentsMap || {};
      this.deploymentToAppMap = obj.deploymentToAppMap || {};
      this.deploymentKeyToDeploymentMap = obj.deploymentKeyToDeploymentMap || {};
      this.accessKeys = obj.accessKeys || {};
      this.accessKeyToAccountMap = obj.accessKeyToAccountMap || {};
      this.accountToAccessKeysMap = obj.accountToAccessKeysMap || {};
      this.accessKeyNameToAccountIdMap = obj.accessKeyNameToAccountIdMap || {};
    });
  }

  private async saveStateAsync(): globalThis.Promise<void> {
    const obj = {
      NextIdNumber: RedisS3Storage.NextIdNumber,
      accounts: this.accounts,
      apps: this.apps,
      deployments: this.deployments,
      blobs: this.blobs,
      accountToAppsMap: this.accountToAppsMap,
      appToAccountMap: this.appToAccountMap,
      appToDeploymentsMap: this.appToDeploymentsMap,
      deploymentToAppMap: this.deploymentToAppMap,
      deploymentKeyToDeploymentMap: this.deploymentKeyToDeploymentMap,
      accessKeys: this.accessKeys,
      accessKeyToAccountMap: this.accessKeyToAccountMap,
      accountToAccessKeysMap: this.accountToAccessKeysMap,
      accessKeyNameToAccountIdMap: this.accessKeyNameToAccountIdMap,
    };
    const str = JSON.stringify(obj);

    this.redisClient.set("state", str);
  }

  public checkHealth(): Promise<void> {
    return q(<void>null);
  }

  public addAccount(account: storage.Account): Promise<string> {
    account = clone(account); // pass by value
    account.id = this.newId();
    // We lower-case the email in our storage lookup because Partition/RowKeys are case-sensitive, but in all other cases we leave
    // the email as-is (as a new account with a different casing would be rejected as a duplicate at creation time)
    const email: string = account.email.toLowerCase();

    if (this.accounts[account.id] || this.accountToAppsMap[account.id] || this.emailToAccountMap[email]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
    }

    this.accountToAppsMap[account.id] = [];
    this.emailToAccountMap[email] = account.id;
    this.accounts[account.id] = account;

    this.saveStateAsync();
    return q(account.id);
  }

  public getAccount(accountId: string): Promise<storage.Account> {
    if (!this.accounts[accountId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.accounts[accountId]));
  }

  public getAccountByEmail(email: string): Promise<storage.Account> {
    for (const id in this.accounts) {
      if (this.accounts[id].email === email) {
        return q(clone(this.accounts[id]));
      }
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public updateAccount(email: string, updates: storage.Account): Promise<void> {
    if (!email) throw new Error("No account email");

    return this.getAccountByEmail(email).then((account: storage.Account) => {
      merge(this.accounts[account.id], updates);
      this.saveStateAsync();
    });
  }

  public getAccountIdFromAccessKey(accessKey: string): Promise<string> {
    if (!this.accessKeyNameToAccountIdMap[accessKey]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (new Date().getTime() >= this.accessKeyNameToAccountIdMap[accessKey].expires) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Expired, "The access key has expired.");
    }

    return q(this.accessKeyNameToAccountIdMap[accessKey].accountId);
  }

  public addApp(accountId: string, app: storage.App): Promise<storage.App> {
    app = clone(app); // pass by value

    const account = this.accounts[accountId];
    if (!account) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    app.id = this.newId();

    const map: storage.CollaboratorMap = {};
    map[account.email] = <storage.CollaboratorProperties>{ accountId: accountId, permission: "Owner" };
    app.collaborators = map;

    const accountApps = this.accountToAppsMap[accountId];
    if (accountApps.indexOf(app.id) === -1) {
      accountApps.push(app.id);
    }

    if (!this.appToDeploymentsMap[app.id]) {
      this.appToDeploymentsMap[app.id] = [];
    }

    this.appToAccountMap[app.id] = accountId;

    this.apps[app.id] = app;

    this.saveStateAsync();

    return q(clone(app));
  }

  public getApps(accountId: string): Promise<storage.App[]> {
    const appIds = this.accountToAppsMap[accountId];
    if (appIds) {
      const storageApps = appIds.map((id: string) => {
        return this.apps[id];
      });
      const apps: storage.App[] = clone(storageApps);
      apps.forEach((app: storage.App) => {
        this.addIsCurrentAccountProperty(app, accountId);
      });

      return q(apps);
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public getApp(accountId: string, appId: string): Promise<storage.App> {
    if (!this.accounts[accountId] || !this.apps[appId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const app: storage.App = clone(this.apps[appId]);
    this.addIsCurrentAccountProperty(app, accountId);

    return q(app);
  }

  public removeApp(accountId: string, appId: string): Promise<void> {
    if (!this.accounts[accountId] || !this.apps[appId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (accountId !== this.appToAccountMap[appId]) {
      throw new Error("Wrong accountId");
    }

    const deployments = this.appToDeploymentsMap[appId].slice();
    const promises: any[] = [];
    deployments.forEach((deploymentId: string) => {
      promises.push(this.removeDeployment(accountId, appId, deploymentId));
    });

    return q.all(promises).then(() => {
      delete this.appToDeploymentsMap[appId];

      const app: storage.App = clone(this.apps[appId]);
      const collaborators: storage.CollaboratorMap = app.collaborators;
      Object.keys(collaborators).forEach((emailKey: string) => {
        this.removeAppPointer(collaborators[emailKey].accountId, appId);
      });
      delete this.apps[appId];

      delete this.appToAccountMap[appId];
      const accountApps = this.accountToAppsMap[accountId];
      accountApps.splice(accountApps.indexOf(appId), 1);

      this.saveStateAsync();

      return q(<void>null);
    });
  }

  public updateApp(accountId: string, app: storage.App, ensureIsOwner: boolean = true): Promise<void> {
    app = clone(app); // pass by value

    if (!this.accounts[accountId] || !this.apps[app.id]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    this.removeIsCurrentAccountProperty(app);
    merge(this.apps[app.id], app);

    this.saveStateAsync();
    return q(<void>null);
  }

  public transferApp(accountId: string, appId: string, email: string): Promise<void> {
    if (isPrototypePollutionKey(email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
    }
    return this.getApp(accountId, appId).then((app: storage.App) => {
      const account: storage.Account = this.accounts[accountId];
      const requesterEmail: string = account.email;
      const targetOwnerAccountId: string = this.emailToAccountMap[email.toLowerCase()];
      if (!targetOwnerAccountId) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound, RedisS3Storage.CollaboratorNotFound);
      }

      // Use the original email stored on the account to ensure casing is consistent
      email = this.accounts[targetOwnerAccountId].email;

      if (this.isOwner(app.collaborators, email)) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
      }

      app.collaborators[requesterEmail].permission = storage.Permissions.Collaborator;
      if (this.isCollaborator(app.collaborators, email)) {
        app.collaborators[email].permission = storage.Permissions.Owner;
      } else {
        app.collaborators[email] = { permission: storage.Permissions.Owner, accountId: targetOwnerAccountId };
        this.addAppPointer(targetOwnerAccountId, app.id);
      }

      return this.updateApp(accountId, app);
    });
  }

  public addCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    if (isPrototypePollutionKey(email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
    }
    return this.getApp(accountId, appId).then((app: storage.App) => {
      if (this.isCollaborator(app.collaborators, email) || this.isOwner(app.collaborators, email)) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
      }

      const targetCollaboratorAccountId: string = this.emailToAccountMap[email.toLowerCase()];
      if (!targetCollaboratorAccountId) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound, RedisS3Storage.CollaboratorNotFound);
      }

      // Use the original email stored on the account to ensure casing is consistent
      email = this.accounts[targetCollaboratorAccountId].email;

      app.collaborators[email] = { accountId: targetCollaboratorAccountId, permission: storage.Permissions.Collaborator };
      this.addAppPointer(targetCollaboratorAccountId, app.id);
      return this.updateApp(accountId, app);
    });
  }

  public getCollaborators(accountId: string, appId: string): Promise<storage.CollaboratorMap> {
    return this.getApp(accountId, appId).then((app: storage.App) => {
      return q<storage.CollaboratorMap>(app.collaborators);
    });
  }

  public removeCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    return this.getApp(accountId, appId).then((app: storage.App) => {
      if (this.isOwner(app.collaborators, email)) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
      }

      const targetCollaboratorAccountId: string = this.emailToAccountMap[email.toLowerCase()];
      if (!this.isCollaborator(app.collaborators, email) || !targetCollaboratorAccountId) {
        return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
      }

      this.removeAppPointer(targetCollaboratorAccountId, appId);
      delete app.collaborators[email];
      return this.updateApp(accountId, app, /*ensureIsOwner*/ false);
    });
  }

  public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<string> {
    deployment = clone(deployment); // pass by value

    const app: storage.App = this.apps[appId];
    if (!this.accounts[accountId] || !app) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.id = this.newId();
    (<any>deployment).packageHistory = [];
    const appDeployments = this.appToDeploymentsMap[appId];
    if (appDeployments.indexOf(deployment.id) === -1) {
      appDeployments.push(deployment.id);
    }

    this.deploymentToAppMap[deployment.id] = appId;
    this.deployments[deployment.id] = deployment;
    this.deploymentKeyToDeploymentMap[deployment.key] = deployment.id;

    this.saveStateAsync();
    return q(deployment.id);
  }

  public getDeploymentInfo(deploymentKey: string): Promise<storage.DeploymentInfo> {
    const deploymentId: string = this.deploymentKeyToDeploymentMap[deploymentKey];
    const deployment: storage.Deployment = this.deployments[deploymentId];

    if (!deploymentId || !deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const appId: string = this.deploymentToAppMap[deployment.id];

    if (!appId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q({ appId: appId, deploymentId: deploymentId });
  }

  public getPackageHistoryFromDeploymentKey(deploymentKey: string): Promise<storage.Package[]> {
    console.log(this.deploymentKeyToDeploymentMap);
    const deploymentId: string = this.deploymentKeyToDeploymentMap[deploymentKey];
    if (!deploymentId || !this.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone((<any>this.deployments[deploymentId]).packageHistory));
  }

  public getDeployment(accountId: string, appId: string, deploymentId: string): Promise<storage.Deployment> {
    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.deployments[deploymentId]));
  }

  public getDeployments(accountId: string, appId: string): Promise<storage.Deployment[]> {
    const deploymentIds = this.appToDeploymentsMap[appId];
    if (this.accounts[accountId] && deploymentIds) {
      const deployments = deploymentIds.map((id: string) => {
        return this.deployments[id];
      });
      return q(clone(deployments));
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public removeDeployment(accountId: string, appId: string, deploymentId: string): Promise<void> {
    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (appId !== this.deploymentToAppMap[deploymentId]) {
      throw new Error("Wrong appId");
    }

    const deployment: storage.Deployment = this.deployments[deploymentId];

    delete this.deploymentKeyToDeploymentMap[deployment.key];
    delete this.deployments[deploymentId];
    delete this.deploymentToAppMap[deploymentId];
    const appDeployments = this.appToDeploymentsMap[appId];
    appDeployments.splice(appDeployments.indexOf(deploymentId), 1);

    this.saveStateAsync();
    return q(<void>null);
  }

  public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<void> {
    deployment = clone(deployment); // pass by value

    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deployment.id]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package; // No-op if a package update is attempted through this method
    merge(this.deployments[deployment.id], deployment);

    this.saveStateAsync();
    return q(<void>null);
  }

  public commitPackage(accountId: string, appId: string, deploymentId: string, appPackage: storage.Package): Promise<storage.Package> {
    appPackage = clone(appPackage); // pass by value

    if (!appPackage) throw new Error("No package specified");
    if (!this.accounts[accountId] || !this.apps[appId] || !this.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const deployment: any = <any>this.deployments[deploymentId];
    deployment.package = appPackage;
    const history: storage.Package[] = deployment.packageHistory;

    // Unset rollout value for last package for rollback.
    const lastPackage: storage.Package = history.length ? history[history.length - 1] : null;
    if (lastPackage) {
      lastPackage.rollout = null;
    }

    deployment.packageHistory.push(appPackage);
    appPackage.label = "v" + deployment.packageHistory.length;

    this.saveStateAsync();
    return q(clone(appPackage));
  }

  public clearPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<void> {
    const deployment: storage.Deployment = this.deployments[deploymentId];
    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package;
    (<any>deployment).packageHistory = [];

    this.saveStateAsync();
    return q(<void>null);
  }

  public getPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<storage.Package[]> {
    const deployment: any = <any>this.deployments[deploymentId];
    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(deployment.packageHistory));
  }

  public updatePackageHistory(accountId: string, appId: string, deploymentId: string, history: storage.Package[]): Promise<void> {
    if (!history || !history.length) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
    }

    const deployment: any = <any>this.deployments[deploymentId];
    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.package = history[history.length - 1];
    deployment.packageHistory = history;
    this.saveStateAsync();

    return q(<void>null);
  }

  public addBlob(blobId: string, stream: stream.Readable, streamLength: number): Promise<string> {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: blobId,
      Body: stream,
    };

    return q
      .Promise<string>((resolve, reject) => {
        this.s3Client
          .send(new PutObjectCommand(params))
          .then(() => {
            resolve(blobId);
          })
          .catch(reject);
      })
      .then(() => {
        this.blobs[blobId] = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${blobId}`;

        this.saveStateAsync();

        return blobId;
      });
  }

  public getBlobUrl(blobId: string): Promise<string> {
    return q.Promise<string>((resolve, reject) => {
      const blobPath = this.blobs[blobId];
      if (blobPath) {
        resolve(blobPath);
      } else {
        reject(new Error("Blob not found"));
      }
    });
  }

  public removeBlob(blobId: string): Promise<void> {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: blobId,
    };

    return q
      .Promise<void>((resolve, reject) => {
        this.s3Client
          .send(new DeleteObjectCommand(params))
          .then(() => {
            resolve();
          })
          .catch(reject);
      })
      .then(() => {
        delete this.blobs[blobId];
        this.saveStateAsync();

        return q(<void>null);
      });
  }

  public addAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<string> {
    accessKey = clone(accessKey); // pass by value

    const account: storage.Account = this.accounts[accountId];

    if (!account) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    accessKey.id = this.newId();

    let accountAccessKeys: string[] = this.accountToAccessKeysMap[accountId];

    if (!accountAccessKeys) {
      accountAccessKeys = this.accountToAccessKeysMap[accountId] = [];
    } else if (accountAccessKeys.indexOf(accessKey.id) !== -1) {
      return q("");
    }

    accountAccessKeys.push(accessKey.id);

    this.accessKeyToAccountMap[accessKey.id] = accountId;
    this.accessKeys[accessKey.id] = accessKey;
    this.accessKeyNameToAccountIdMap[accessKey.name] = { accountId, expires: accessKey.expires };

    this.saveStateAsync();

    return q(accessKey.id);
  }

  public getAccessKey(accountId: string, accessKeyId: string): Promise<storage.AccessKey> {
    const expectedAccountId: string = this.accessKeyToAccountMap[accessKeyId];

    if (!expectedAccountId || expectedAccountId !== accountId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return q(clone(this.accessKeys[accessKeyId]));
  }

  public getAccessKeys(accountId: string): Promise<storage.AccessKey[]> {
    const accessKeyIds: string[] = this.accountToAccessKeysMap[accountId];

    if (accessKeyIds) {
      const accessKeys: storage.AccessKey[] = accessKeyIds.map((id: string): storage.AccessKey => {
        return this.accessKeys[id];
      });

      return q(clone(accessKeys));
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    const expectedAccountId: string = this.accessKeyToAccountMap[accessKeyId];

    if (expectedAccountId && expectedAccountId === accountId) {
      const accessKey: storage.AccessKey = this.accessKeys[accessKeyId];

      delete this.accessKeyNameToAccountIdMap[accessKey.name];
      delete this.accessKeys[accessKeyId];
      delete this.accessKeyToAccountMap[accessKeyId];

      const accessKeyIds: string[] = this.accountToAccessKeysMap[accountId];
      const index: number = accessKeyIds.indexOf(accessKeyId);

      if (index >= 0) {
        accessKeyIds.splice(index, /*deleteCount*/ 1);
      }

      this.saveStateAsync();
      return q(<void>null);
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public updateAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<void> {
    accessKey = clone(accessKey); // pass by value

    if (accessKey && accessKey.id) {
      const expectedAccountId: string = this.accessKeyToAccountMap[accessKey.id];

      if (expectedAccountId && expectedAccountId === accountId) {
        merge(this.accessKeys[accessKey.id], accessKey);
        this.accessKeyNameToAccountIdMap[accessKey.name].expires = accessKey.expires;

        this.saveStateAsync();
        return q(<void>null);
      }
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public dropAll(): Promise<void> {
    if (this._blobServerPromise) {
      return this._blobServerPromise.then((server: http.Server) => {
        const deferred: q.Deferred<void> = q.defer<void>();
        server.close((err?: Error) => {
          if (err) {
            deferred.reject(err);
          } else {
            deferred.resolve();
          }
        });
        return deferred.promise;
      });
    }

    return q(<void>null);
  }

  private addIsCurrentAccountProperty(app: storage.App, accountId: string): void {
    if (app && app.collaborators) {
      Object.keys(app.collaborators).forEach((email: string) => {
        if (app.collaborators[email].accountId === accountId) {
          app.collaborators[email].isCurrentAccount = true;
        }
      });
    }
  }

  private removeIsCurrentAccountProperty(app: storage.App): void {
    if (app && app.collaborators) {
      Object.keys(app.collaborators).forEach((email: string) => {
        if (app.collaborators[email].isCurrentAccount) {
          delete app.collaborators[email].isCurrentAccount;
        }
      });
    }
  }

  private isOwner(list: storage.CollaboratorMap, email: string): boolean {
    return list && list[email] && list[email].permission === storage.Permissions.Owner;
  }

  private isCollaborator(list: storage.CollaboratorMap, email: string): boolean {
    return list && list[email] && list[email].permission === storage.Permissions.Collaborator;
  }

  private isAccountIdCollaborator(list: storage.CollaboratorMap, accountId: string): boolean {
    const keys: string[] = Object.keys(list);
    for (let i = 0; i < keys.length; i++) {
      if (list[keys[i]].accountId === accountId) {
        return true;
      }
    }

    return false;
  }

  private removeAppPointer(accountId: string, appId: string): void {
    const accountApps: string[] = this.accountToAppsMap[accountId];
    const index: number = accountApps.indexOf(appId);
    if (index > -1) {
      accountApps.splice(index, 1);
    }
  }

  private addAppPointer(accountId: string, appId: string): void {
    const accountApps = this.accountToAppsMap[accountId];
    if (accountApps.indexOf(appId) === -1) {
      accountApps.push(appId);
    }
  }

  private getBlobServer(): Promise<http.Server> {
    if (!this._blobServerPromise) {
      const app: express.Express = express();

      app.get("/:blobId", (req: express.Request, res: express.Response, next: (err?: Error) => void): any => {
        const blobId: string = req.params.blobId;
        if (this.blobs[blobId]) {
          res.send(this.blobs[blobId]);
        } else {
          res.sendStatus(404);
        }
      });

      const deferred: q.Deferred<http.Server> = q.defer<http.Server>();
      const server: http.Server = app.listen(0, () => {
        deferred.resolve(server);
      });

      this._blobServerPromise = deferred.promise;
    }

    return this._blobServerPromise;
  }

  private newId(): string {
    const id = "id_" + RedisS3Storage.NextIdNumber;
    RedisS3Storage.NextIdNumber += 1;
    return id;
  }

  private static getRejectedPromise(errorCode: storage.ErrorCode, message?: string): Promise<any> {
    return q.reject(storage.storageError(errorCode, message));
  }
}
