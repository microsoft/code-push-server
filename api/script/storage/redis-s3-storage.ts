// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as http from "http";
import * as stream from "stream";
import * as libStorage from "@aws-sdk/lib-storage";
import * as uuid from "uuid";

import * as storage from "./storage";

import clone = storage.clone;
import { isPrototypePollutionKey } from "./storage";
import path = require("path");
import * as Redis from "redis";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promisify } from "util";

function merge(original: any, updates: any): void {
  for (const property in updates) {
    original[property] = updates[property];
  }
}

export class RedisS3Storage implements storage.Storage {
  private static CollaboratorNotFound: string = "The specified e-mail address doesn't represent a registered user";
  private redisClient: Redis.RedisClientType<Redis.RedisDefaultModules, Redis.RedisFunctions, Redis.RedisScripts>;
  private s3Client: S3Client;
  private _blobServerPromise: Promise<http.Server>;
  private updatesDir: string = path.join(__dirname, "updates");

  private async loadStateAsync(): Promise<storage.StorageItem> {
    const DEFAULT_STATE: storage.StorageItem = {
      id: this.newId(),
      accounts: {},
      apps: {},
      deployments: {},
      packages: {},
      blobs: {},
      accessKeys: {},
      deploymentKeys: {},
      accountToAppsMap: {},
      appToAccountMap: {},
      emailToAccountMap: {},
      appToDeploymentsMap: {},
      deploymentToAppMap: {},
      deploymentKeyToDeploymentMap: {},
      accountToAccessKeysMap: {},
      accessKeyToAccountMap: {},
      accessKeyNameToAccountIdMap: {},
    };

    try {
      const state = await this.redisClient.get("state");

      if (!state) {
        return DEFAULT_STATE;
      }

      return JSON.parse(state);
    } catch {
      return DEFAULT_STATE;
    }
  }

  private async saveStateAsync(newState: storage.StorageItem): Promise<void> {
    this.redisClient.set("state", JSON.stringify(newState));
  }

  public async initialize(): Promise<void> {
    const client = await Redis.createClient({
      url: process.env.REDIS_URL,
    }).connect();

    this.redisClient = client;

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS,
      },
      logger: console,
    });

    if (!fs.existsSync(this.updatesDir)) {
      fs.mkdirSync(this.updatesDir);
    }
  }

  public checkHealth(): Promise<void> {
    return null;
  }

  public async addAccount(account: storage.Account): Promise<string> {
    const currentState = await this.loadStateAsync();

    account = clone(account);
    account.id = this.newId();
    // We lower-case the email in our storage lookup because Partition/RowKeys are case-sensitive, but in all other cases we leave
    // the email as-is (as a new account with a different casing would be rejected as a duplicate at creation time)
    const email: string = account.email.toLowerCase();

    if (currentState.emailToAccountMap[email]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
    }

    currentState.accountToAppsMap[account.id] = [];
    currentState.emailToAccountMap[email] = account.id;
    currentState.accounts[account.id] = account;

    await this.saveStateAsync(currentState);
    return account.id;
  }

  public async getAccount(accountId: string): Promise<storage.Account> {
    const { accounts } = await this.loadStateAsync();

    if (!accounts[accountId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return clone(accounts[accountId]);
  }

  public async getAccountByEmail(email: string): Promise<storage.Account> {
    const { accounts } = await this.loadStateAsync();

    for (const id in accounts) {
      if (accounts[id].email === email) {
        return clone(accounts[id]);
      }
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public async updateAccount(email: string, updates: storage.Account): Promise<void> {
    if (!email) throw new Error("No account email");

    const currentState = await this.loadStateAsync();

    const account = await this.getAccountByEmail(email);
    merge(currentState.accounts[account.id], updates);

    await this.saveStateAsync(currentState);
  }

  public async getAccountIdFromAccessKey(accessKey: string): Promise<string> {
    const { accessKeyNameToAccountIdMap } = await this.loadStateAsync();

    if (!accessKeyNameToAccountIdMap[accessKey]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (new Date().getTime() >= accessKeyNameToAccountIdMap[accessKey].expires) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Expired, "The access key has expired.");
    }

    return accessKeyNameToAccountIdMap[accessKey].accountId;
  }

  public async addApp(accountId: string, app: storage.App): Promise<storage.App> {
    const currentState = await this.loadStateAsync();
    app = clone(app);

    const account = currentState.accounts[accountId];
    if (!account) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    app.id = this.newId();

    const map: storage.CollaboratorMap = {};
    map[account.email] = <storage.CollaboratorProperties>{ accountId: accountId, permission: "Owner" };
    app.collaborators = map;

    const accountApps = currentState.accountToAppsMap[accountId];

    if (accountApps.indexOf(app.id) === -1) {
      accountApps.push(app.id);
    }

    if (!currentState.appToDeploymentsMap[app.id]) {
      currentState.appToDeploymentsMap[app.id] = [];
    }

    currentState.appToAccountMap[app.id] = accountId;

    currentState.apps[app.id] = app;

    await this.saveStateAsync(currentState);

    return clone(app);
  }

  public async getApps(accountId: string): Promise<storage.App[]> {
    const { accountToAppsMap, apps } = await this.loadStateAsync();

    const appIds = accountToAppsMap[accountId];

    if (appIds) {
      const storageApps = appIds.map((id: string) => {
        return apps[id];
      });

      const clonedApps: storage.App[] = clone(storageApps);

      clonedApps.forEach((app: storage.App) => {
        this.addIsCurrentAccountProperty(app, accountId);
      });

      return clonedApps;
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public async getApp(accountId: string, appId: string): Promise<storage.App> {
    const { apps, accounts } = await this.loadStateAsync();

    if (!accounts[accountId] || !apps[appId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const app: storage.App = clone(apps[appId]);
    this.addIsCurrentAccountProperty(app, accountId);

    return app;
  }

  public async removeApp(accountId: string, appId: string): Promise<void> {
    const currentState = await this.loadStateAsync();

    if (!currentState.accounts[accountId] || !currentState.apps[appId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (accountId !== currentState.appToAccountMap[appId]) {
      throw new Error("Wrong accountId");
    }

    const deployments = currentState.appToDeploymentsMap[appId].slice();

    for (const deploymentId of deployments) {
      await this.handleRemoveDeployment(accountId, appId, deploymentId, currentState);
    }

    delete currentState.appToDeploymentsMap[appId];

    const app: storage.App = clone(currentState.apps[appId]);
    const collaborators: storage.CollaboratorMap = app.collaborators;

    Object.keys(collaborators).forEach((emailKey: string) => {
      this.removeAppPointer(collaborators[emailKey].accountId, appId, currentState.accountToAppsMap);
    });

    delete currentState.apps[appId];
    delete currentState.appToAccountMap[appId];

    await this.saveStateAsync(currentState);

    return null;
  }

  public async updateApp(accountId: string, app: storage.App, ensureIsOwner: boolean = true): Promise<void> {
    const currentState = await this.loadStateAsync();
    app = clone(app);

    if (!currentState.accounts[accountId] || !currentState.apps[app.id]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    this.removeIsCurrentAccountProperty(app);
    merge(currentState.apps[app.id], app);

    await this.saveStateAsync(currentState);

    return null;
  }

  public async transferApp(accountId: string, appId: string, email: string): Promise<void> {
    if (isPrototypePollutionKey(email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
    }

    const { accounts, emailToAccountMap, accountToAppsMap } = await this.loadStateAsync();

    const app = await this.getApp(accountId, appId);
    const account: storage.Account = accounts[accountId];
    const requesterEmail: string = account.email;
    const targetOwnerAccountId: string = emailToAccountMap[email.toLowerCase()];

    if (!targetOwnerAccountId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound, RedisS3Storage.CollaboratorNotFound);
    }

    // Use the original email stored on the account to ensure casing is consistent
    email = accounts[targetOwnerAccountId].email;
    if (this.isOwner(app.collaborators, email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
    }

    app.collaborators[requesterEmail].permission = storage.Permissions.Collaborator;
    if (this.isCollaborator(app.collaborators, email)) {
      app.collaborators[email].permission = storage.Permissions.Owner;
    } else {
      app.collaborators[email] = { permission: storage.Permissions.Owner, accountId: targetOwnerAccountId };
      this.addAppPointer(targetOwnerAccountId, app.id, accountToAppsMap);
    }

    return this.updateApp(accountId, app);
  }

  public async addCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    if (isPrototypePollutionKey(email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Invalid email parameter");
    }

    const { emailToAccountMap, accounts, accountToAppsMap } = await this.loadStateAsync();

    const app = await this.getApp(accountId, appId);

    if (this.isCollaborator(app.collaborators, email) || this.isOwner(app.collaborators, email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
    }

    const targetCollaboratorAccountId: string = emailToAccountMap[email.toLowerCase()];
    if (!targetCollaboratorAccountId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound, RedisS3Storage.CollaboratorNotFound);
    }

    // Use the original email stored on the account to ensure casing is consistent
    email = accounts[targetCollaboratorAccountId].email;
    app.collaborators[email] = { accountId: targetCollaboratorAccountId, permission: storage.Permissions.Collaborator };

    this.addAppPointer(targetCollaboratorAccountId, app.id, accountToAppsMap);

    return this.updateApp(accountId, app);
  }

  public async getCollaborators(accountId: string, appId: string): Promise<storage.CollaboratorMap> {
    const app = await this.getApp(accountId, appId);

    return app.collaborators;
  }

  public async removeCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    const app = await this.getApp(accountId, appId);
    if (this.isOwner(app.collaborators, email)) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.AlreadyExists);
    }

    const { emailToAccountMap, accountToAppsMap } = await this.loadStateAsync();

    const targetCollaboratorAccountId: string = emailToAccountMap[email.toLowerCase()];

    if (!this.isCollaborator(app.collaborators, email) || !targetCollaboratorAccountId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    this.removeAppPointer(targetCollaboratorAccountId, appId, accountToAppsMap);

    delete app.collaborators[email];

    return await this.updateApp(accountId, app, /*ensureIsOwner*/ false);
  }

  private async handleAddDeployment(
    accountId: string,
    appId: string,
    deployment: storage.Deployment,
    currentState: storage.StorageItem,
  ): Promise<void> {
    deployment = clone(deployment);

    const app: storage.App = currentState.apps[appId];
    if (!currentState.accounts[accountId] || !app) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.id = this.newId();
    (<any>deployment).packageHistory = [];

    const appDeployments = currentState.appToDeploymentsMap[appId];
    if (appDeployments.indexOf(deployment.id) === -1) {
      appDeployments.push(deployment.id);
    }

    currentState.deploymentToAppMap[deployment.id] = appId;
    currentState.deployments[deployment.id] = deployment;
    currentState.deploymentKeyToDeploymentMap[deployment.key] = deployment.id;
  }

  public async addDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<string> {
    const currentState = await this.loadStateAsync();

    await this.handleAddDeployment(accountId, appId, deployment, currentState);

    await this.saveStateAsync(currentState);

    return deployment.id;
  }

  public async addDeployments(accountId: string, appId: string, deployments: storage.Deployment[]): Promise<string[]> {
    const currentState = await this.loadStateAsync();
    const clonedDeployments = deployments.map(clone);

    for (const deployment of clonedDeployments) {
      await this.handleAddDeployment(accountId, appId, deployment, currentState);
    }

    await this.saveStateAsync(currentState);

    return clonedDeployments.map((deployment) => deployment.id);
  }

  public async getDeploymentInfo(deploymentKey: string): Promise<storage.DeploymentInfo> {
    const { deploymentKeyToDeploymentMap, deployments, deploymentToAppMap } = await this.loadStateAsync();

    const deploymentId: string = deploymentKeyToDeploymentMap[deploymentKey];
    const deployment: storage.Deployment = deployments[deploymentId];

    if (!deploymentId || !deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const appId: string = deploymentToAppMap[deployment.id];

    if (!appId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return { appId: appId, deploymentId: deploymentId };
  }

  public async getPackageHistoryFromDeploymentKey(deploymentKey: string): Promise<storage.Package[]> {
    const { deploymentKeyToDeploymentMap, deployments } = await this.loadStateAsync();
    const deploymentId: string = deploymentKeyToDeploymentMap[deploymentKey];

    if (!deploymentId || !deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return clone((<any>deployments[deploymentId]).packageHistory);
  }

  public async getDeployment(accountId: string, appId: string, deploymentId: string): Promise<storage.Deployment> {
    const { accounts, apps, deployments } = await this.loadStateAsync();

    if (!accounts[accountId] || !apps[appId] || !deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return clone(deployments[deploymentId]);
  }

  public async getDeployments(accountId: string, appId: string): Promise<storage.Deployment[]> {
    const { appToDeploymentsMap, accounts, deployments } = await this.loadStateAsync();

    const deploymentIds = appToDeploymentsMap[appId];

    if (accounts[accountId] && deploymentIds) {
      const deploymentsCopy = deploymentIds.map((id: string) => {
        return deployments[id];
      });

      return clone(deploymentsCopy);
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  private async handleRemoveDeployment(
    accountId: string,
    appId: string,
    deploymentId: string,
    currentState: storage.StorageItem,
  ): Promise<storage.StorageItem> {
    if (!currentState.accounts[accountId] || !currentState.apps[appId] || !currentState.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    if (appId !== currentState.deploymentToAppMap[deploymentId]) {
      throw new Error("Wrong appId");
    }

    const deployment: storage.Deployment = currentState.deployments[deploymentId];

    delete currentState.deploymentKeyToDeploymentMap[deployment.key];
    delete currentState.deployments[deploymentId];
    delete currentState.deploymentToAppMap[deploymentId];

    const appDeployments = currentState.appToDeploymentsMap[appId];
    appDeployments.splice(appDeployments.indexOf(deploymentId), 1);

    return currentState;
  }

  public async removeDeployment(accountId: string, appId: string, deploymentId: string): Promise<void> {
    const currentState = await this.loadStateAsync();

    const newState = await this.handleRemoveDeployment(accountId, appId, deploymentId, currentState);

    await this.saveStateAsync(newState);

    return null;
  }

  public async updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<void> {
    const currentState = await this.loadStateAsync();

    deployment = clone(deployment);

    if (!currentState.accounts[accountId] || !currentState.apps[appId] || !currentState.deployments[deployment.id]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package; // No-op if a package update is attempted through this method
    merge(currentState.deployments[deployment.id], deployment);

    await this.saveStateAsync(currentState);

    return null;
  }

  public async commitPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: storage.Package,
  ): Promise<storage.Package> {
    appPackage = clone(appPackage);

    if (!appPackage) throw new Error("No package specified");

    const currentState = await this.loadStateAsync();

    if (!currentState.accounts[accountId] || !currentState.apps[appId] || !currentState.deployments[deploymentId]) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    const deployment: any = <any>currentState.deployments[deploymentId];
    deployment.package = appPackage;
    const history: storage.Package[] = deployment.packageHistory;

    // Unset rollout value for last package for rollback.
    const lastPackage: storage.Package = history.length ? history[history.length - 1] : null;
    if (lastPackage) {
      lastPackage.rollout = null;
    }

    deployment.packageHistory.push(appPackage);
    appPackage.label = "v" + deployment.packageHistory.length;

    await this.saveStateAsync(currentState);

    return clone(appPackage);
  }

  public async clearPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<void> {
    const currentState = await this.loadStateAsync();

    const deployment: storage.Deployment = currentState.deployments[deploymentId];
    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    delete deployment.package;
    (<any>deployment).packageHistory = [];

    await this.saveStateAsync(currentState);
    return null;
  }

  public async getPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<storage.Package[]> {
    const { deployments } = await this.loadStateAsync();
    const deployment: any = deployments[deploymentId];

    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return clone(deployment.packageHistory);
  }

  public async updatePackageHistory(
    accountId: string,
    appId: string,
    deploymentId: string,
    history: storage.Package[],
  ): Promise<void> {
    if (!history || !history.length) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
    }

    const currentState = await this.loadStateAsync();

    const deployment: any = currentState.deployments[deploymentId];
    if (!deployment) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    deployment.package = history[history.length - 1];
    deployment.packageHistory = history;

    await this.saveStateAsync(currentState);

    return null;
  }

  public async addBlob(blobId: string, stream: stream.Readable): Promise<string> {
    const upload = new libStorage.Upload({
      client: this.s3Client,
      params: {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: blobId,
        Body: stream,
        ACL: "public-read",
      },
    });

    await new Promise<string>((resolve, reject) => {
      upload.on("httpUploadProgress", (progress) => {
        console.log(`Uploaded ${progress.loaded} bytes of ${progress.total || "unknown total size"}`);
      });

      upload
        .done()
        .then(() => {
          resolve(blobId);
        })
        .catch(reject);
    });

    const currentState = await this.loadStateAsync();
    currentState.blobs[blobId] = `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${blobId}`;

    await this.saveStateAsync(currentState);

    return blobId;
  }

  public async getBlobUrl(blobId: string): Promise<string> {
    const { blobs } = await this.loadStateAsync();

    return new Promise<string>((resolve, reject) => {
      const blobPath = blobs[blobId];

      if (blobPath) {
        resolve(blobPath);
      } else {
        reject(new Error("Blob not found"));
      }
    });
  }

  public async removeBlob(blobId: string): Promise<void> {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: blobId,
    };

    await new Promise<void>((resolve, reject) => {
      this.s3Client
        .send(new DeleteObjectCommand(params))
        .then(() => {
          resolve();
        })
        .catch(reject);
    });

    const currentState = await this.loadStateAsync();
    delete currentState.blobs[blobId];

    await this.saveStateAsync(currentState);

    return null;
  }

  public async addAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<string> {
    const currentState = await this.loadStateAsync();

    const clonedAccessKey = clone(accessKey);
    const account: storage.Account = currentState.accounts[accountId];

    if (!account) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    clonedAccessKey.id = this.newId();

    let accountAccessKeys: string[] = currentState.accountToAccessKeysMap[accountId];

    if (!accountAccessKeys) {
      accountAccessKeys = currentState.accountToAccessKeysMap[accountId] = [];
    } else if (accountAccessKeys.indexOf(clonedAccessKey.id) !== -1) {
      return "";
    }

    accountAccessKeys.push(clonedAccessKey.id);

    currentState.accessKeyToAccountMap[clonedAccessKey.id] = accountId;
    currentState.accessKeys[clonedAccessKey.id] = clonedAccessKey;
    currentState.accessKeyNameToAccountIdMap[clonedAccessKey.name] = { accountId, expires: clonedAccessKey.expires };

    await this.saveStateAsync(currentState);

    return clonedAccessKey.id;
  }

  public async getAccessKey(accountId: string, accessKeyId: string): Promise<storage.AccessKey> {
    const { accessKeys, accessKeyToAccountMap } = await this.loadStateAsync();

    const expectedAccountId: string = accessKeyToAccountMap[accessKeyId];

    if (!expectedAccountId || expectedAccountId !== accountId) {
      return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
    }

    return clone(accessKeys[accessKeyId]);
  }

  public async getAccessKeys(accountId: string): Promise<storage.AccessKey[]> {
    const { accountToAccessKeysMap, accessKeys } = await this.loadStateAsync();

    const accessKeyIds: string[] = accountToAccessKeysMap[accountId];

    if (accessKeyIds) {
      const storedAccessKeys: storage.AccessKey[] = accessKeyIds.map((id: string): storage.AccessKey => {
        return accessKeys[id];
      });

      return clone(storedAccessKeys);
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public async removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    const currentState = await this.loadStateAsync();
    const expectedAccountId: string = currentState.accessKeyToAccountMap[accessKeyId];

    if (expectedAccountId && expectedAccountId === accountId) {
      const accessKey: storage.AccessKey = currentState.accessKeys[accessKeyId];

      delete currentState.accessKeyNameToAccountIdMap[accessKey.name];
      delete currentState.accessKeys[accessKeyId];
      delete currentState.accessKeyToAccountMap[accessKeyId];

      const accessKeyIds: string[] = currentState.accountToAccessKeysMap[accountId];
      const index: number = accessKeyIds.indexOf(accessKeyId);

      if (index >= 0) {
        accessKeyIds.splice(index, /*deleteCount*/ 1);
      }

      await this.saveStateAsync(currentState);

      return null;
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public async updateAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<void> {
    accessKey = clone(accessKey);

    if (accessKey && accessKey.id) {
      const currentState = await this.loadStateAsync();

      const expectedAccountId: string = currentState.accessKeyToAccountMap[accessKey.id];

      if (expectedAccountId && expectedAccountId === accountId) {
        merge(currentState.accessKeys[accessKey.id], accessKey);
        currentState.accessKeyNameToAccountIdMap[accessKey.name].expires = accessKey.expires;

        await this.saveStateAsync(currentState);

        return null;
      }
    }

    return RedisS3Storage.getRejectedPromise(storage.ErrorCode.NotFound);
  }

  public dropAll(): Promise<void> {
    if (this._blobServerPromise) {
      return this._blobServerPromise.then((server: http.Server) => {
        const closeServer = promisify(server.close.bind(server));
        return closeServer();
      });
    }

    return null;
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

  private removeAppPointer(accountId: string, appId: string, accountToAppsMap: storage.StorageItem["accountToAppsMap"]): void {
    const accountApps: string[] = accountToAppsMap[accountId];
    const index: number = accountApps.indexOf(appId);
    if (index > -1) {
      accountApps.splice(index, 1);
    }
  }

  private addAppPointer(accountId: string, appId: string, accountToAppsMap: storage.StorageItem["accountToAppsMap"]): void {
    const accountApps = accountToAppsMap[accountId];
    if (accountApps.indexOf(appId) === -1) {
      accountApps.push(appId);
    }
  }

  private newId(): string {
    return uuid.v4();
  }

  private static getRejectedPromise(errorCode: storage.ErrorCode, message?: string): Promise<any> {
    return Promise.reject(storage.storageError(errorCode, message));
  }
}
