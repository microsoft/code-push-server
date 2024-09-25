// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import nodeDeepCopy = require("node-deepcopy");

import {
  AccessKey,
  AccessKeyRequest,
  Account,
  App,
  AppCreationRequest,
  CollaboratorMap,
  CollaboratorProperties,
  Deployment,
  DeploymentMetrics,
  Package,
} from "../types/rest-definitions";

import Storage = require("../storage/storage");
import * as redis from "../redis-manager";

export function accessKeyRequestFromBody(body: AccessKeyRequest): AccessKeyRequest {
  const accessKeyRequest: AccessKeyRequest = <AccessKeyRequest>{};
  if (body.createdBy !== undefined) {
    accessKeyRequest.createdBy = body.createdBy;
  }

  if (body.ttl !== undefined) {
    // Use parseInt in case the value sent to us is a string. parseInt will return the same number if it is already a number.
    accessKeyRequest.ttl = parseInt(<string>(<any>body.ttl), 10);
  }

  if (body.name !== undefined) {
    accessKeyRequest.name = body.name;
  }

  // This caters to legacy CLIs, before "description" was renamed to "friendlyName".
  accessKeyRequest.friendlyName = body.friendlyName === undefined ? body.description : body.friendlyName;
  accessKeyRequest.friendlyName = accessKeyRequest.friendlyName && accessKeyRequest.friendlyName.trim();
  accessKeyRequest.description = accessKeyRequest.friendlyName;

  return accessKeyRequest;
}

export function accountFromBody(body: Account): Account {
  const account: Account = <Account>{};

  account.name = body.name;
  account.email = body.email;

  return account;
}

export function appFromBody(body: App): App {
  const app: App = <App>{};

  app.name = body.name;

  return app;
}

export function appCreationRequestFromBody(body: AppCreationRequest): AppCreationRequest {
  const appCreationRequest: AppCreationRequest = <AppCreationRequest>{};

  appCreationRequest.name = body.name;
  appCreationRequest.manuallyProvisionDeployments = body.manuallyProvisionDeployments;

  return appCreationRequest;
}

export function deploymentFromBody(body: Deployment): Deployment {
  const deployment: Deployment = <Deployment>{};

  deployment.name = body.name;
  deployment.key = body.key;

  return deployment;
}

export function toRestAccount(storageAccount: Storage.Account): Account {
  const restAccount: Account = {
    name: storageAccount.name,
    email: storageAccount.email,
    linkedProviders: [],
  };

  if (storageAccount.azureAdId) restAccount.linkedProviders.push("AAD");
  if (storageAccount.gitHubId) restAccount.linkedProviders.push("GitHub");
  if (storageAccount.microsoftId) restAccount.linkedProviders.push("Microsoft");

  return restAccount;
}

export function sortAndUpdateDisplayNameOfRestAppsList(apps: App[]): App[] {
  const nameToCountMap: { [name: string]: number } = {};
  apps.forEach((app: App) => {
    nameToCountMap[app.name] = nameToCountMap[app.name] || 0;
    nameToCountMap[app.name]++;
  });

  return apps
    .sort((first: App, second: App) => {
      // Sort by raw name instead of display name
      return first.name.localeCompare(second.name);
    })
    .map((app: App) => {
      const storageApp = toStorageApp(app, 0);

      let name: string = app.name;
      if (nameToCountMap[app.name] > 1 && !Storage.isOwnedByCurrentUser(storageApp)) {
        const ownerEmail: string = Storage.getOwnerEmail(storageApp);
        name = `${ownerEmail}:${app.name}`;
      }

      return toRestApp(storageApp, name, app.deployments);
    });
}

export function toRestApp(storageApp: Storage.App, displayName: string, deploymentNames: string[]): App {
  const sortedDeploymentNames: string[] = deploymentNames
    ? deploymentNames.sort((first: string, second: string) => {
        return first.localeCompare(second);
      })
    : null;

  return <App>{
    name: displayName,
    collaborators: toRestCollaboratorMap(storageApp.collaborators),
    deployments: sortedDeploymentNames,
  };
}

export function toRestCollaboratorMap(storageCollaboratorMap: Storage.CollaboratorMap): CollaboratorMap {
  const collaboratorMap: CollaboratorMap = {};

  Object.keys(storageCollaboratorMap)
    .sort()
    .forEach(function (key: string) {
      collaboratorMap[key] = <CollaboratorProperties>{
        isCurrentAccount: storageCollaboratorMap[key].isCurrentAccount,
        permission: storageCollaboratorMap[key].permission,
      };
    });

  return collaboratorMap;
}

export function toRestDeployment(storageDeployment: Storage.Deployment): Deployment {
  const restDeployment = <Deployment>{
    name: storageDeployment.name,
    key: storageDeployment.key,
    package: storageDeployment.package,
  };

  if (restDeployment.package) {
    delete (<any>restDeployment.package).manifestBlobUrl;
  }

  return restDeployment;
}

export function toRestDeploymentMetrics(metricsFromRedis: any): DeploymentMetrics {
  if (!metricsFromRedis) {
    return {};
  }

  const restDeploymentMetrics: DeploymentMetrics = {};
  const totalActive: number = 0;
  const labelRegex = /^v\d+$/;

  Object.keys(metricsFromRedis).forEach((metricKey: string) => {
    const parsedKey: string[] = metricKey.split(":");
    const label: string = parsedKey[0];
    const metricType: string = parsedKey[1];
    if (!restDeploymentMetrics[label]) {
      restDeploymentMetrics[label] = labelRegex.test(label)
        ? {
            active: 0,
            downloaded: 0,
            failed: 0,
            installed: 0,
          }
        : {
            active: 0,
          };
    }

    switch (metricType) {
      case redis.ACTIVE:
        restDeploymentMetrics[label].active += metricsFromRedis[metricKey];
        break;
      case redis.DOWNLOADED:
        restDeploymentMetrics[label].downloaded += metricsFromRedis[metricKey];
        break;
      case redis.DEPLOYMENT_SUCCEEDED:
        restDeploymentMetrics[label].installed += metricsFromRedis[metricKey];
        break;
      case redis.DEPLOYMENT_FAILED:
        restDeploymentMetrics[label].failed += metricsFromRedis[metricKey];
        break;
    }
  });

  return restDeploymentMetrics;
}

export function toRestPackage(storagePackage: Storage.Package): Package {
  const copy: Package = nodeDeepCopy.deepCopy(storagePackage);

  const cast: Storage.Package = <any>copy;
  delete cast.manifestBlobUrl;

  if (copy.rollout === undefined || copy.rollout === null) copy.rollout = 100;

  return copy;
}

export function toStorageAccessKey(restAccessKey: AccessKey): Storage.AccessKey {
  const storageAccessKey = <Storage.AccessKey>{
    name: restAccessKey.name,
    createdTime: restAccessKey.createdTime,
    createdBy: restAccessKey.createdBy,
    expires: restAccessKey.expires,
    friendlyName: restAccessKey.friendlyName,
    description: restAccessKey.friendlyName,
  };

  return storageAccessKey;
}

export function toStorageApp(restApp: App, createdTime: number): Storage.App {
  const storageApp: Storage.App = {
    createdTime: createdTime,
    name: restApp.name,
    collaborators: toStorageCollaboratorMap(restApp.collaborators),
  };
  return storageApp;
}

export function toStorageCollaboratorMap(restCollaboratorMap: CollaboratorMap): Storage.CollaboratorMap {
  if (!restCollaboratorMap) return null;

  return <Storage.CollaboratorMap>nodeDeepCopy.deepCopy(restCollaboratorMap);
}

export function toStorageDeployment(restDeployment: Deployment, createdTime: number): Storage.Deployment {
  const storageDeployment = <Storage.Deployment>{
    createdTime: createdTime,
    name: restDeployment.name,
    key: restDeployment.key,
    package: nodeDeepCopy.deepCopy(restDeployment.package),
  };
  return storageDeployment;
}

export function toStoragePackage(restPackage: Package): Storage.Package {
  return nodeDeepCopy.deepCopy(restPackage);
}
