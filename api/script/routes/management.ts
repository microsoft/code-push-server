// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createTempFileFromBuffer, getFileWithField } from "../file-upload-manager";
import { getIpAddress } from "../utils/rest-headers";
import { isUnfinishedRollout } from "../utils/rollout-selector";
import * as packageDiffing from "../utils/package-diffing";
import * as converterUtils from "../utils/converter";
import * as diffErrorUtils from "../utils/diff-error-handling";
import * as error from "../error";
import * as errorUtils from "../utils/rest-error-handling";
import { Request, Response, Router } from "express";
import * as fs from "fs";
import * as hashUtils from "../utils/hash-utils";
import * as q from "q";
import * as redis from "../redis-manager";
import * as restTypes from "../types/rest-definitions";
import * as security from "../utils/security";
import * as semver from "semver";
import * as stream from "stream";
import * as streamifier from "streamifier";
import * as storageTypes from "../storage/storage";
import * as validationUtils from "../utils/validation";
import PackageDiffer = packageDiffing.PackageDiffer;
import NameResolver = storageTypes.NameResolver;
import PackageManifest = hashUtils.PackageManifest;
import Promise = q.Promise;
import tryJSON = require("try-json");
import rateLimit from "express-rate-limit";
import { isPrototypePollutionKey } from "../storage/storage";

const DEFAULT_ACCESS_KEY_EXPIRY = 1000 * 60 * 60 * 24 * 60; // 60 days
const ACCESS_KEY_MASKING_STRING = "(hidden)";

export interface ManagementConfig {
  storage: storageTypes.Storage;
  redisManager: redis.RedisManager;
}

// A template string tag function that URL encodes the substituted values
function urlEncode(strings: string[], ...values: string[]): string {
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += encodeURIComponent(values[i]);
    }
  }

  return result;
}

export function getManagementRouter(config: ManagementConfig): Router {
  const redisManager: redis.RedisManager = config.redisManager;
  const storage: storageTypes.Storage = config.storage;
  const packageDiffing = new PackageDiffer(storage, parseInt(process.env.DIFF_PACKAGE_COUNT) || 5);
  const router: Router = Router();
  const nameResolver: NameResolver = new NameResolver(config.storage);

  router.get("/account", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    storage
      .getAccount(accountId)
      .then((storageAccount: storageTypes.Account) => {
        const restAccount: restTypes.Account = converterUtils.toRestAccount(storageAccount);
        res.send({ account: restAccount });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/accessKeys", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;

    storage
      .getAccessKeys(accountId)
      .then((accessKeys: storageTypes.AccessKey[]): void => {
        accessKeys.sort((first: storageTypes.AccessKey, second: storageTypes.AccessKey) => {
          const firstTime = first.createdTime || 0;
          const secondTime = second.createdTime || 0;
          return firstTime - secondTime;
        });

        // Hide the actual key string and replace it with a message for legacy CLIs (up to 1.11.0-beta) that still try to display it
        accessKeys.forEach((accessKey: restTypes.AccessKey) => {
          accessKey.name = ACCESS_KEY_MASKING_STRING;
        });

        res.send({ accessKeys: accessKeys });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.post("/accessKeys", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const accessKeyRequest: restTypes.AccessKeyRequest = converterUtils.accessKeyRequestFromBody(req.body);
    if (!accessKeyRequest.name) {
      accessKeyRequest.name = security.generateSecureKey(accountId);
    }

    if (!accessKeyRequest.createdBy) {
      accessKeyRequest.createdBy = getIpAddress(req);
    }

    const validationErrors: validationUtils.ValidationError[] = validationUtils.validateAccessKeyRequest(
      accessKeyRequest,
      /*isUpdate=*/ false
    );

    if (validationErrors.length) {
      res.status(400).send(validationErrors);
      return;
    }

    const accessKey: restTypes.AccessKey = <restTypes.AccessKey>(<restTypes.AccessKey>accessKeyRequest);

    accessKey.createdTime = new Date().getTime();
    accessKey.expires = accessKey.createdTime + (accessKeyRequest.ttl || DEFAULT_ACCESS_KEY_EXPIRY);
    delete accessKeyRequest.ttl;

    storage
      .getAccessKeys(accountId)
      .then((accessKeys: storageTypes.AccessKey[]): void | Promise<void> => {
        if (NameResolver.isDuplicate(accessKeys, accessKey.name)) {
          errorUtils.sendConflictError(res, `The access key "${accessKey.name}" already exists.`);
          return;
        } else if (NameResolver.isDuplicate(accessKeys, accessKey.friendlyName)) {
          errorUtils.sendConflictError(res, `The access key "${accessKey.friendlyName}" already exists.`);
          return;
        }

        const storageAccessKey: storageTypes.AccessKey = converterUtils.toStorageAccessKey(accessKey);
        return storage.addAccessKey(accountId, storageAccessKey).then((id: string): void => {
          res.setHeader("Location", urlEncode([`/accessKeys/${accessKey.friendlyName}`]));
          res.status(201).send({ accessKey: accessKey });
        });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/accessKeys/:accessKeyName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accessKeyName: string = req.params.accessKeyName;
    const accountId: string = req.user.id;

    nameResolver
      .resolveAccessKey(accountId, accessKeyName)
      .then((accessKey: storageTypes.AccessKey): void => {
        delete accessKey.name;
        res.send({ accessKey: accessKey });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.patch("/accessKeys/:accessKeyName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const accessKeyName: string = req.params.accessKeyName;
    const accessKeyRequest: restTypes.AccessKeyRequest = converterUtils.accessKeyRequestFromBody(req.body);

    const validationErrors: validationUtils.ValidationError[] = validationUtils.validateAccessKeyRequest(
      accessKeyRequest,
      /*isUpdate=*/ true
    );
    if (validationErrors.length) {
      res.status(400).send(validationErrors);
      return;
    }

    let updatedAccessKey: storageTypes.AccessKey;
    storage
      .getAccessKeys(accountId)
      .then((accessKeys: storageTypes.AccessKey[]): Promise<void> => {
        updatedAccessKey = NameResolver.findByName(accessKeys, accessKeyName);
        if (!updatedAccessKey) {
          throw errorUtils.restError(errorUtils.ErrorCode.NotFound, `The access key "${accessKeyName}" does not exist.`);
        }

        if (accessKeyRequest.friendlyName) {
          if (NameResolver.isDuplicate(accessKeys, accessKeyRequest.friendlyName)) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.Conflict,
              `The access key "${accessKeyRequest.friendlyName}" already exists.`
            );
          }

          updatedAccessKey.friendlyName = accessKeyRequest.friendlyName;
          updatedAccessKey.description = updatedAccessKey.friendlyName;
        }

        if (accessKeyRequest.ttl !== undefined) {
          updatedAccessKey.expires = new Date().getTime() + accessKeyRequest.ttl;
        }

        return storage.updateAccessKey(accountId, updatedAccessKey);
      })
      .then((): void => {
        delete updatedAccessKey.name;
        res.send({ accessKey: updatedAccessKey });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.delete("/accessKeys/:accessKeyName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const accessKeyName: string = req.params.accessKeyName;

    nameResolver
      .resolveAccessKey(accountId, accessKeyName)
      .then((accessKey: storageTypes.AccessKey): Promise<void> => {
        return storage.removeAccessKey(accountId, accessKey.id);
      })
      .then((): void => {
        res.sendStatus(204);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.delete("/sessions/:createdBy", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const createdBy: string = req.params.createdBy;

    storage
      .getAccessKeys(accountId)
      .then((accessKeys: storageTypes.AccessKey[]) => {
        const accessKeyDeletionPromises: Promise<void>[] = [];
        accessKeys.forEach((accessKey: storageTypes.AccessKey) => {
          if (accessKey.isSession && accessKey.createdBy === createdBy) {
            accessKeyDeletionPromises.push(storage.removeAccessKey(accountId, accessKey.id));
          }
        });

        if (accessKeyDeletionPromises.length) {
          return q.all(accessKeyDeletionPromises);
        } else {
          throw errorUtils.restError(errorUtils.ErrorCode.NotFound, `There are no sessions associated with "${createdBy}."`);
        }
      })
      .then((): void => {
        res.sendStatus(204);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/apps", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    storage
      .getApps(accountId)
      .then((apps: storageTypes.App[]) => {
        const restAppPromises: Promise<restTypes.App>[] = apps.map((app: storageTypes.App) => {
          return storage.getDeployments(accountId, app.id).then((deployments: storageTypes.Deployment[]) => {
            const deploymentNames: string[] = deployments.map((deployment: storageTypes.Deployment) => deployment.name);
            return converterUtils.toRestApp(app, app.name, deploymentNames);
          });
        });

        return q.all(restAppPromises);
      })
      .then((restApps: restTypes.App[]) => {
        res.send({ apps: converterUtils.sortAndUpdateDisplayNameOfRestAppsList(restApps) });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.post("/apps", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appRequest: restTypes.AppCreationRequest = converterUtils.appCreationRequestFromBody(req.body);

    const validationErrors = validationUtils.validateApp(appRequest, /*isUpdate=*/ false);
    if (validationErrors.length) {
      errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
    } else {
      storage
        .getApps(accountId)
        .then((apps: storageTypes.App[]): void | Promise<void> => {
          if (NameResolver.isDuplicate(apps, appRequest.name)) {
            errorUtils.sendConflictError(res, "An app named '" + appRequest.name + "' already exists.");
            return;
          }

          let storageApp: storageTypes.App = converterUtils.toStorageApp(appRequest, new Date().getTime());

          return storage
            .addApp(accountId, storageApp)
            .then((app: storageTypes.App): Promise<string[]> => {
              storageApp = app;
              if (!appRequest.manuallyProvisionDeployments) {
                const defaultDeployments: string[] = ["Production", "Staging"];
                const deploymentPromises: Promise<string>[] = defaultDeployments.map((deploymentName: string) => {
                  const deployment: storageTypes.Deployment = {
                    createdTime: new Date().getTime(),
                    name: deploymentName,
                    key: security.generateSecureKey(accountId),
                  };

                  return storage.addDeployment(accountId, storageApp.id, deployment).then(() => {
                    return deployment.name;
                  });
                });

                return q.all(deploymentPromises);
              }
            })
            .then((deploymentNames: string[]): void => {
              res.setHeader("Location", urlEncode([`/apps/${storageApp.name}`]));
              res.status(201).send({ app: converterUtils.toRestApp(storageApp, /*displayName=*/ storageApp.name, deploymentNames) });
            });
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    }
  });

  router.get("/apps/:appName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    let storageApp: storageTypes.App;
    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        storageApp = app;
        return storage.getDeployments(accountId, app.id);
      })
      .then((deployments: storageTypes.Deployment[]) => {
        const deploymentNames: string[] = deployments.map((deployment) => deployment.name);
        res.send({ app: converterUtils.toRestApp(storageApp, /*displayName=*/ appName, deploymentNames) });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.delete("/apps/:appName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    let appId: string;
    let invalidationError: Error;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return storage.getDeployments(accountId, appId);
      })
      .then((deployments: storageTypes.Deployment[]) => {
        const invalidationPromises: Promise<void>[] = deployments.map((deployment: storageTypes.Deployment) => {
          return invalidateCachedPackage(deployment.key);
        });

        return q.all(invalidationPromises).catch((error: Error) => {
          invalidationError = error; // Do not block app deletion on cache invalidation
        });
      })
      .then(() => {
        return storage.removeApp(accountId, appId);
      })
      .then(() => {
        res.sendStatus(204);
        if (invalidationError) throw invalidationError;
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.patch("/apps/:appName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const app: restTypes.App = converterUtils.appFromBody(req.body);

    storage
      .getApps(accountId)
      .then((apps: storageTypes.App[]): void | Promise<void> => {
        const existingApp: storageTypes.App = NameResolver.findByName(apps, appName);
        if (!existingApp) {
          errorUtils.sendNotFoundError(res, `App "${appName}" does not exist.`);
          return;
        }
        throwIfInvalidPermissions(existingApp, storageTypes.Permissions.Owner);

        if ((app.name || app.name === "") && app.name !== existingApp.name) {
          if (NameResolver.isDuplicate(apps, app.name)) {
            errorUtils.sendConflictError(res, "An app named '" + app.name + "' already exists.");
            return;
          }

          existingApp.name = app.name;
        }

        const validationErrors = validationUtils.validateApp(existingApp, /*isUpdate=*/ true);
        if (validationErrors.length) {
          errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
        } else {
          return storage
            .updateApp(accountId, existingApp)
            .then(() => {
              return storage.getDeployments(accountId, existingApp.id).then((deployments: storageTypes.Deployment[]) => {
                const deploymentNames: string[] = deployments.map((deployment: storageTypes.Deployment) => {
                  return deployment.name;
                });
                return converterUtils.toRestApp(existingApp, existingApp.name, deploymentNames);
              });
            })
            .then((restApp: restTypes.App) => {
              res.send({ app: restApp });
            });
        }
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.post("/apps/:appName/transfer/:email", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const email: string = req.params.email;

    if (isPrototypePollutionKey(email)) {
      return res.status(400).send("Invalid email parameter");
    }

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return storage.transferApp(accountId, app.id, email);
      })
      .then(() => {
        res.sendStatus(201);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.post("/apps/:appName/collaborators/:email", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const email: string = req.params.email;

    if (isPrototypePollutionKey(email)) {
      return res.status(400).send("Invalid email parameter");
    }

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return storage.addCollaborator(accountId, app.id, email);
      })
      .then(() => {
        res.sendStatus(201);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/apps/:appName/collaborators", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
        return storage.getCollaborators(accountId, app.id);
      })
      .then((retrievedMap: storageTypes.CollaboratorMap) => {
        res.send({ collaborators: converterUtils.toRestCollaboratorMap(retrievedMap) });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.delete("/apps/:appName/collaborators/:email", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const email: string = req.params.email;

    if (isPrototypePollutionKey(email)) {
      return res.status(400).send("Invalid email parameter");
    }

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        const isAttemptingToRemoveSelf: boolean =
          app.collaborators && email && app.collaborators[email] && app.collaborators[email].isCurrentAccount;
        throwIfInvalidPermissions(
          app,
          isAttemptingToRemoveSelf ? storageTypes.Permissions.Collaborator : storageTypes.Permissions.Owner
        );
        return storage.removeCollaborator(accountId, app.id, email);
      })
      .then(() => {
        res.sendStatus(204);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/apps/:appName/deployments", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    let appId: string;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
        return storage.getDeployments(accountId, appId);
      })
      .then((deployments: storageTypes.Deployment[]) => {
        deployments.sort((first: restTypes.Deployment, second: restTypes.Deployment) => {
          return first.name.localeCompare(second.name);
        });

        res.send({ deployments: deployments });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.post("/apps/:appName/deployments", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    let appId: string;
    let restDeployment: restTypes.Deployment = converterUtils.deploymentFromBody(req.body);

    const validationErrors = validationUtils.validateDeployment(restDeployment, /*isUpdate=*/ false);
    if (validationErrors.length) {
      errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
      return;
    }

    const storageDeployment: storageTypes.Deployment = converterUtils.toStorageDeployment(restDeployment, new Date().getTime());
    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return storage.getDeployments(accountId, app.id);
      })
      .then((deployments: storageTypes.Deployment[]): void | Promise<void> => {
        if (NameResolver.isDuplicate(deployments, restDeployment.name)) {
          errorUtils.sendConflictError(res, "A deployment named '" + restDeployment.name + "' already exists.");
          return;
        }

        // Allow the deployment key to be specified on creation, if desired
        storageDeployment.key = restDeployment.key || security.generateSecureKey(accountId);

        return storage.addDeployment(accountId, appId, storageDeployment).then((deploymentId: string): void => {
          restDeployment = converterUtils.toRestDeployment(storageDeployment);
          res.setHeader("Location", urlEncode([`/apps/${appName}/deployments/${restDeployment.name}`]));
          res.status(201).send({ deployment: restDeployment });
        });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/apps/:appName/deployments/:deploymentName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    let appId: string;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
        return nameResolver.resolveDeployment(accountId, appId, deploymentName);
      })
      .then((deployment: storageTypes.Deployment) => {
        const restDeployment: restTypes.Deployment = converterUtils.toRestDeployment(deployment);
        res.send({ deployment: restDeployment });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.delete("/apps/:appName/deployments/:deploymentName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    let appId: string;
    let deploymentId: string;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return nameResolver.resolveDeployment(accountId, appId, deploymentName);
      })
      .then((deployment: storageTypes.Deployment) => {
        deploymentId = deployment.id;
        return invalidateCachedPackage(deployment.key);
      })
      .then(() => {
        return storage.removeDeployment(accountId, appId, deploymentId);
      })
      .then(() => {
        res.sendStatus(204);
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.patch("/apps/:appName/deployments/:deploymentName", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    let appId: string;
    let restDeployment: restTypes.Deployment = converterUtils.deploymentFromBody(req.body);

    const validationErrors = validationUtils.validateDeployment(restDeployment, /*isUpdate=*/ true);
    if (validationErrors.length) {
      errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
      return;
    }

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
        return storage.getDeployments(accountId, app.id);
      })
      .then((storageDeployments: storageTypes.Deployment[]): void | Promise<void> => {
        const storageDeployment: storageTypes.Deployment = NameResolver.findByName(storageDeployments, deploymentName);

        if (!storageDeployment) {
          errorUtils.sendNotFoundError(res, `Deployment "${deploymentName}" does not exist.`);
          return;
        }

        if ((restDeployment.name || restDeployment.name === "") && restDeployment.name !== storageDeployment.name) {
          if (NameResolver.isDuplicate(storageDeployments, restDeployment.name)) {
            errorUtils.sendConflictError(res, "A deployment named '" + restDeployment.name + "' already exists.");
            return;
          }
          storageDeployment.name = restDeployment.name;
        }

        restDeployment = converterUtils.toRestDeployment(storageDeployment);
        return storage.updateDeployment(accountId, appId, storageDeployment).then(() => {
          res.send({ deployment: restDeployment });
        });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.patch("/apps/:appName/deployments/:deploymentName/release", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    const info: restTypes.PackageInfo = req.body.packageInfo || {};
    const validationErrors: validationUtils.ValidationError[] = validationUtils.validatePackageInfo(info, /*allOptional*/ true);
    if (validationErrors.length) {
      errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
      return;
    }

    let updateRelease: boolean = false;
    let storageDeployment: storageTypes.Deployment;
    let appId: string;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
        return storage.getDeployments(accountId, app.id);
      })
      .then((storageDeployments: storageTypes.Deployment[]) => {
        storageDeployment = NameResolver.findByName(storageDeployments, deploymentName);

        if (!storageDeployment) {
          throw errorUtils.restError(errorUtils.ErrorCode.NotFound, `Deployment "${deploymentName}" does not exist.`);
        }

        return storage.getPackageHistory(accountId, appId, storageDeployment.id);
      })
      .then((packageHistory: storageTypes.Package[]) => {
        if (!packageHistory.length) {
          throw errorUtils.restError(errorUtils.ErrorCode.NotFound, "Deployment has no releases.");
        }

        const packageToUpdate: storageTypes.Package = info.label
          ? getPackageFromLabel(packageHistory, info.label)
          : packageHistory[packageHistory.length - 1];

        if (!packageToUpdate) {
          throw errorUtils.restError(errorUtils.ErrorCode.NotFound, "Release not found for given label.");
        }

        const newIsDisabled: boolean = info.isDisabled;
        if (validationUtils.isDefined(newIsDisabled) && packageToUpdate.isDisabled !== newIsDisabled) {
          packageToUpdate.isDisabled = newIsDisabled;
          updateRelease = true;
        }

        const newIsMandatory: boolean = info.isMandatory;
        if (validationUtils.isDefined(newIsMandatory) && packageToUpdate.isMandatory !== newIsMandatory) {
          packageToUpdate.isMandatory = newIsMandatory;
          updateRelease = true;
        }

        if (info.description && packageToUpdate.description !== info.description) {
          packageToUpdate.description = info.description;
          updateRelease = true;
        }

        const newRolloutValue: number = info.rollout;
        if (validationUtils.isDefined(newRolloutValue)) {
          let errorMessage: string;
          if (!isUnfinishedRollout(packageToUpdate.rollout)) {
            errorMessage = "Cannot update rollout value for a completed rollout release.";
          } else if (packageToUpdate.rollout >= newRolloutValue) {
            errorMessage = `Rollout value must be greater than "${packageToUpdate.rollout}", the existing value.`;
          }

          if (errorMessage) {
            throw errorUtils.restError(errorUtils.ErrorCode.Conflict, errorMessage);
          }

          packageToUpdate.rollout = newRolloutValue === 100 ? null : newRolloutValue;
          updateRelease = true;
        }

        const newAppVersion: string = info.appVersion;
        if (newAppVersion && packageToUpdate.appVersion !== newAppVersion) {
          packageToUpdate.appVersion = newAppVersion;
          updateRelease = true;
        }

        if (updateRelease) {
          return storage.updatePackageHistory(accountId, appId, storageDeployment.id, packageHistory).then(() => {
            res.send({ package: converterUtils.toRestPackage(packageToUpdate) });
            return invalidateCachedPackage(storageDeployment.key);
          });
        } else {
          res.sendStatus(204);
        }
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  const releaseRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  });

  router.post("/apps/:appName/deployments/:deploymentName/release", releaseRateLimiter, (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    const file: any = getFileWithField(req, "package");

    if (!file || !file.buffer) {
      errorUtils.sendMalformedRequestError(res, "A deployment package must include a file.");
      return;
    }

    const filePath: string = createTempFileFromBuffer(file.buffer);
    const restPackage: restTypes.Package = tryJSON(req.body.packageInfo) || {};
    const validationErrors: validationUtils.ValidationError[] = validationUtils.validatePackageInfo(
      restPackage,
      /*allOptional*/ false
    );
    if (validationErrors.length) {
      errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
      return;
    }

    fs.stat(filePath, (err: NodeJS.ErrnoException, stats: fs.Stats): void => {
      if (err) {
        errorUtils.sendUnknownError(res, err, next);
        return;
      }

      // These variables are for hoisting promise results and flattening the following promise chain.
      let appId: string;
      let deploymentToReleaseTo: storageTypes.Deployment;
      let storagePackage: storageTypes.Package;
      let lastPackageHashWithSameAppVersion: string;
      let newManifest: PackageManifest;

      nameResolver
        .resolveApp(accountId, appName)
        .then((app: storageTypes.App) => {
          appId = app.id;
          throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
          return nameResolver.resolveDeployment(accountId, appId, deploymentName);
        })
        .then((deployment: storageTypes.Deployment) => {
          deploymentToReleaseTo = deployment;
          const existingPackage: storageTypes.Package = deployment.package;
          if (existingPackage && isUnfinishedRollout(existingPackage.rollout) && !existingPackage.isDisabled) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.Conflict,
              "Please update the previous release to 100% rollout before releasing a new package."
            );
          }

          return storage.getPackageHistory(accountId, appId, deploymentToReleaseTo.id);
        })
        .then((history: storageTypes.Package[]) => {
          lastPackageHashWithSameAppVersion = getLastPackageHashWithSameAppVersion(history, restPackage.appVersion);
          return hashUtils.generatePackageManifestFromZip(filePath);
        })
        .then((manifest?: PackageManifest) => {
          if (manifest) {
            newManifest = manifest;
            // If update is a zip, generate a packageHash using the manifest, since
            // that more accurately represents the contents of each file in the zip.
            return newManifest.computePackageHash();
          } else {
            // Update is not a zip (flat file), generate the packageHash over the
            // entire file contents.
            return hashUtils.hashFile(filePath);
          }
        })
        .then((packageHash: string) => {
          restPackage.packageHash = packageHash;
          if (restPackage.packageHash === lastPackageHashWithSameAppVersion) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.Conflict,
              "The uploaded package was not released because it is identical to the contents of the specified deployment's current release."
            );
          }

          return storage.addBlob(security.generateSecureKey(accountId), fs.createReadStream(filePath), stats.size);
        })
        .then((blobId: string) => storage.getBlobUrl(blobId))
        .then((blobUrl: string) => {
          restPackage.blobUrl = blobUrl;
          restPackage.size = stats.size;

          // If newManifest is null/undefined, then the package is not a valid ZIP file.
          if (newManifest) {
            const json: string = newManifest.serialize();
            const readStream: stream.Readable = streamifier.createReadStream(json);

            return storage.addBlob(security.generateSecureKey(accountId), readStream, json.length);
          }

          return q(<string>null);
        })
        .then((blobId?: string) => {
          if (blobId) {
            return storage.getBlobUrl(blobId);
          }

          return q(<string>null);
        })
        .then((manifestBlobUrl?: string) => {
          storagePackage = converterUtils.toStoragePackage(restPackage);
          if (manifestBlobUrl) {
            storagePackage.manifestBlobUrl = manifestBlobUrl;
          }

          storagePackage.releaseMethod = storageTypes.ReleaseMethod.Upload;
          storagePackage.uploadTime = new Date().getTime();
          return storage.commitPackage(accountId, appId, deploymentToReleaseTo.id, storagePackage);
        })
        .then((committedPackage: storageTypes.Package): Promise<void> => {
          storagePackage.label = committedPackage.label;
          const restPackage: restTypes.Package = converterUtils.toRestPackage(committedPackage);

          res.setHeader("Location", urlEncode([`/apps/${appName}/deployments/${deploymentName}`]));
          res.status(201).send({ package: restPackage }); // Send response without blocking on cleanup

          return invalidateCachedPackage(deploymentToReleaseTo.key);
        })
        .then(() => processDiff(accountId, appId, deploymentToReleaseTo.id, storagePackage))
        .finally((): void => {
          // Cleanup; any errors before this point will still pass to the catch() block
          fs.unlink(filePath, (err: NodeJS.ErrnoException): void => {
            if (err) {
              errorUtils.sendUnknownError(res, err, next);
            }
          });
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    });
  });

  router.delete(
    "/apps/:appName/deployments/:deploymentName/history",
    (req: Request, res: Response, next: (err?: any) => void): any => {
      const accountId: string = req.user.id;
      const appName: string = req.params.appName;
      const deploymentName: string = req.params.deploymentName;
      let appId: string;
      let deploymentToGetHistoryOf: storageTypes.Deployment;

      nameResolver
        .resolveApp(accountId, appName)
        .then((app: storageTypes.App): Promise<storageTypes.Deployment> => {
          appId = app.id;
          throwIfInvalidPermissions(app, storageTypes.Permissions.Owner);
          return nameResolver.resolveDeployment(accountId, appId, deploymentName);
        })
        .then((deployment: storageTypes.Deployment): Promise<void> => {
          deploymentToGetHistoryOf = deployment;
          return storage.clearPackageHistory(accountId, appId, deploymentToGetHistoryOf.id);
        })
        .then(() => {
          if (redisManager.isEnabled) {
            return redisManager.clearMetricsForDeploymentKey(deploymentToGetHistoryOf.key);
          } else {
            return q(<void>null);
          }
        })
        .then(() => {
          res.sendStatus(204);
          return invalidateCachedPackage(deploymentToGetHistoryOf.key);
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    }
  );

  router.get("/apps/:appName/deployments/:deploymentName/history", (req: Request, res: Response, next: (err?: any) => void): any => {
    const accountId: string = req.user.id;
    const appName: string = req.params.appName;
    const deploymentName: string = req.params.deploymentName;
    let appId: string;

    nameResolver
      .resolveApp(accountId, appName)
      .then((app: storageTypes.App) => {
        appId = app.id;
        throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
        return nameResolver.resolveDeployment(accountId, appId, deploymentName);
      })
      .then((deployment: storageTypes.Deployment): Promise<storageTypes.Package[]> => {
        return storage.getPackageHistory(accountId, appId, deployment.id);
      })
      .then((packageHistory: storageTypes.Package[]) => {
        res.send({ history: packageHistory });
      })
      .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
      .done();
  });

  router.get("/apps/:appName/deployments/:deploymentName/metrics", (req: Request, res: Response, next: (err?: any) => void): any => {
    if (!redisManager.isEnabled) {
      res.send({ metrics: {} });
    } else {
      const accountId: string = req.user.id;
      const appName: string = req.params.appName;
      const deploymentName: string = req.params.deploymentName;
      let appId: string;

      nameResolver
        .resolveApp(accountId, appName)
        .then((app: storageTypes.App) => {
          appId = app.id;
          throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
          return nameResolver.resolveDeployment(accountId, appId, deploymentName);
        })
        .then((deployment: storageTypes.Deployment): Promise<redis.DeploymentMetrics> => {
          return redisManager.getMetricsWithDeploymentKey(deployment.key);
        })
        .then((metrics: redis.DeploymentMetrics) => {
          const deploymentMetrics: restTypes.DeploymentMetrics = converterUtils.toRestDeploymentMetrics(metrics);
          res.send({ metrics: deploymentMetrics });
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    }
  });

  router.post(
    "/apps/:appName/deployments/:sourceDeploymentName/promote/:destDeploymentName",
    (req: Request, res: Response, next: (err?: any) => void): any => {
      const accountId: string = req.user.id;
      const appName: string = req.params.appName;
      const sourceDeploymentName: string = req.params.sourceDeploymentName;
      const destDeploymentName: string = req.params.destDeploymentName;
      const info: restTypes.PackageInfo = req.body.packageInfo || {};
      const validationErrors: validationUtils.ValidationError[] = validationUtils.validatePackageInfo(info, /*allOptional*/ true);
      if (validationErrors.length) {
        errorUtils.sendMalformedRequestError(res, JSON.stringify(validationErrors));
        return;
      }

      let appId: string;
      let destDeployment: storageTypes.Deployment;
      let sourcePackage: storageTypes.Package;

      nameResolver
        .resolveApp(accountId, appName)
        .then((app: storageTypes.App) => {
          appId = app.id;
          throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
          // Get source and dest manifests in parallel.
          return q.all([
            nameResolver.resolveDeployment(accountId, appId, sourceDeploymentName),
            nameResolver.resolveDeployment(accountId, appId, destDeploymentName),
          ]);
        })
        .spread((sourceDeployment: storageTypes.Deployment, destinationDeployment: storageTypes.Deployment) => {
          destDeployment = destinationDeployment;

          if (info.label) {
            return storage.getPackageHistory(accountId, appId, sourceDeployment.id).then((sourceHistory: storageTypes.Package[]) => {
              sourcePackage = getPackageFromLabel(sourceHistory, info.label);
            });
          } else {
            sourcePackage = sourceDeployment.package;
          }
        })
        .then(() => {
          const destPackage: storageTypes.Package = destDeployment.package;

          if (!sourcePackage) {
            throw errorUtils.restError(errorUtils.ErrorCode.NotFound, "Cannot promote from a deployment with no enabled releases.");
          } else if (validationUtils.isDefined(info.rollout) && !validationUtils.isValidRolloutField(info.rollout)) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.MalformedRequest,
              "Rollout value must be an integer between 1 and 100, inclusive."
            );
          } else if (destPackage && isUnfinishedRollout(destPackage.rollout) && !destPackage.isDisabled) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.Conflict,
              "Cannot promote to an unfinished rollout release unless it is already disabled."
            );
          }

          return storage.getPackageHistory(accountId, appId, destDeployment.id);
        })
        .then((destHistory: storageTypes.Package[]) => {
          if (sourcePackage.packageHash === getLastPackageHashWithSameAppVersion(destHistory, sourcePackage.appVersion)) {
            throw errorUtils.restError(
              errorUtils.ErrorCode.Conflict,
              "The uploaded package was not promoted because it is identical to the contents of the targeted deployment's current release."
            );
          }

          const isMandatory: boolean = validationUtils.isDefined(info.isMandatory) ? info.isMandatory : sourcePackage.isMandatory;
          const newPackage: storageTypes.Package = {
            appVersion: info.appVersion ? info.appVersion : sourcePackage.appVersion,
            blobUrl: sourcePackage.blobUrl,
            description: info.description || sourcePackage.description,
            isDisabled: validationUtils.isDefined(info.isDisabled) ? info.isDisabled : sourcePackage.isDisabled,
            isMandatory: isMandatory,
            manifestBlobUrl: sourcePackage.manifestBlobUrl,
            packageHash: sourcePackage.packageHash,
            rollout: info.rollout || null,
            size: sourcePackage.size,
            uploadTime: new Date().getTime(),
            releaseMethod: storageTypes.ReleaseMethod.Promote,
            originalLabel: sourcePackage.label,
            originalDeployment: sourceDeploymentName,
          };

          return storage
            .commitPackage(accountId, appId, destDeployment.id, newPackage)
            .then((committedPackage: storageTypes.Package): Promise<void> => {
              sourcePackage.label = committedPackage.label;
              const restPackage: restTypes.Package = converterUtils.toRestPackage(committedPackage);
              res.setHeader("Location", urlEncode([`/apps/${appName}/deployments/${destDeploymentName}`]));
              res.status(201).send({ package: restPackage });
              return invalidateCachedPackage(destDeployment.key);
            })
            .then(() => processDiff(accountId, appId, destDeployment.id, sourcePackage));
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    }
  );

  router.post(
    "/apps/:appName/deployments/:deploymentName/rollback/:targetRelease?",
    (req: Request, res: Response, next: (err?: any) => void): any => {
      const accountId: string = req.user.id;
      const appName: string = req.params.appName;
      const deploymentName: string = req.params.deploymentName;
      let appId: string;
      let deploymentToRollback: storageTypes.Deployment;
      const targetRelease: string = req.params.targetRelease;
      let destinationPackage: storageTypes.Package;

      nameResolver
        .resolveApp(accountId, appName)
        .then((app: storageTypes.App) => {
          appId = app.id;
          throwIfInvalidPermissions(app, storageTypes.Permissions.Collaborator);
          return nameResolver.resolveDeployment(accountId, appId, deploymentName);
        })
        .then((deployment: storageTypes.Deployment): Promise<storageTypes.Package[]> => {
          deploymentToRollback = deployment;
          return storage.getPackageHistory(accountId, appId, deployment.id);
        })
        .then((packageHistory: storageTypes.Package[]) => {
          const sourcePackage: storageTypes.Package =
            packageHistory && packageHistory.length ? packageHistory[packageHistory.length - 1] : null;
          if (!sourcePackage) {
            errorUtils.sendNotFoundError(res, "Cannot perform rollback because there are no releases on this deployment.");
            return;
          }

          if (!targetRelease) {
            destinationPackage = packageHistory[packageHistory.length - 2];

            if (!destinationPackage) {
              errorUtils.sendNotFoundError(res, "Cannot perform rollback because there are no prior releases to rollback to.");
              return;
            }
          } else {
            if (targetRelease === sourcePackage.label) {
              errorUtils.sendConflictError(
                res,
                `Cannot perform rollback because the target release (${targetRelease}) is already the latest release.`
              );
              return;
            }

            packageHistory.forEach((packageEntry: storageTypes.Package) => {
              if (packageEntry.label === targetRelease) {
                destinationPackage = packageEntry;
              }
            });

            if (!destinationPackage) {
              errorUtils.sendNotFoundError(
                res,
                `Cannot perform rollback because the target release (${targetRelease}) could not be found in the deployment history.`
              );
              return;
            }
          }

          if (sourcePackage.appVersion !== destinationPackage.appVersion) {
            errorUtils.sendConflictError(
              res,
              "Cannot perform rollback to a different app version. Please perform a new release with the desired replacement package."
            );
            return;
          }

          const newPackage: storageTypes.Package = {
            appVersion: destinationPackage.appVersion,
            blobUrl: destinationPackage.blobUrl,
            description: destinationPackage.description,
            diffPackageMap: destinationPackage.diffPackageMap,
            isDisabled: destinationPackage.isDisabled,
            isMandatory: destinationPackage.isMandatory,
            manifestBlobUrl: destinationPackage.manifestBlobUrl,
            packageHash: destinationPackage.packageHash,
            size: destinationPackage.size,
            uploadTime: new Date().getTime(),
            releaseMethod: storageTypes.ReleaseMethod.Rollback,
            originalLabel: destinationPackage.label,
          };

          return storage.commitPackage(accountId, appId, deploymentToRollback.id, newPackage).then((): Promise<void> => {
            const restPackage: restTypes.Package = converterUtils.toRestPackage(newPackage);
            res.setHeader("Location", urlEncode([`/apps/${appName}/deployments/${deploymentName}`]));
            res.status(201).send({ package: restPackage });
            return invalidateCachedPackage(deploymentToRollback.key);
          });
        })
        .catch((error: error.CodePushError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    }
  );

  function invalidateCachedPackage(deploymentKey: string): Q.Promise<void> {
    return redisManager.invalidateCache(redis.Utilities.getDeploymentKeyHash(deploymentKey));
  }

  function throwIfInvalidPermissions(app: storageTypes.App, requiredPermission: string): boolean {
    const collaboratorsMap: storageTypes.CollaboratorMap = app.collaborators;

    let isPermitted: boolean = false;

    if (collaboratorsMap) {
      for (const email of Object.keys(collaboratorsMap)) {
        if ((<storageTypes.CollaboratorProperties>collaboratorsMap[email]).isCurrentAccount) {
          const permission: string = collaboratorsMap[email].permission;
          isPermitted = permission === storageTypes.Permissions.Owner || permission === requiredPermission;
          break;
        }
      }
    }

    if (!isPermitted)
      throw errorUtils.restError(
        errorUtils.ErrorCode.Unauthorized,
        "This action requires " + requiredPermission + " permissions on the app!"
      );

    return true;
  }

  function getPackageFromLabel(history: storageTypes.Package[], label: string): storageTypes.Package {
    if (!history) {
      return null;
    }

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].label === label) {
        return history[i];
      }
    }

    return null;
  }

  function getLastPackageHashWithSameAppVersion(history: storageTypes.Package[], appVersion: string): string {
    if (!history || !history.length) {
      return null;
    }

    const lastPackageIndex: number = history.length - 1;
    if (!semver.valid(appVersion)) {
      // appVersion is a range
      const oldAppVersion: string = history[lastPackageIndex].appVersion;
      const oldRange: string = semver.validRange(oldAppVersion);
      const newRange: string = semver.validRange(appVersion);
      return oldRange === newRange ? history[lastPackageIndex].packageHash : null;
    } else {
      // appVersion is not a range
      for (let i = lastPackageIndex; i >= 0; i--) {
        if (semver.satisfies(appVersion, history[i].appVersion)) {
          return history[i].packageHash;
        }
      }
    }

    return null;
  }

  function addDiffInfoForPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: storageTypes.Package,
    diffPackageMap: storageTypes.PackageHashToBlobInfoMap
  ) {
    let updateHistory: boolean = false;

    return storage
      .getApp(accountId, appId)
      .then((storageApp: storageTypes.App) => {
        throwIfInvalidPermissions(storageApp, storageTypes.Permissions.Collaborator);
        return storage.getPackageHistory(accountId, appId, deploymentId);
      })
      .then((history: storageTypes.Package[]) => {
        if (history) {
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].label === appPackage.label && !history[i].diffPackageMap) {
              history[i].diffPackageMap = diffPackageMap;
              updateHistory = true;
              break;
            }
          }

          if (updateHistory) {
            return storage.updatePackageHistory(accountId, appId, deploymentId, history);
          }
        }
      })
      .then(() => {
        if (updateHistory) {
          return storage.getDeployment(accountId, appId, deploymentId).then((deployment: storageTypes.Deployment) => {
            return invalidateCachedPackage(deployment.key);
          });
        }
      })
      .catch(diffErrorUtils.diffErrorHandler);
  }

  function processDiff(accountId: string, appId: string, deploymentId: string, appPackage: storageTypes.Package): q.Promise<void> {
    if (!appPackage.manifestBlobUrl || process.env.ENABLE_PACKAGE_DIFFING) {
      // No need to process diff because either:
      //   1. The release just contains a single file.
      //   2. Diffing disabled.
      return q(<void>null);
    }

    console.log(`Processing package: ${appPackage.label}`);

    return packageDiffing
      .generateDiffPackageMap(accountId, appId, deploymentId, appPackage)
      .then((diffPackageMap: storageTypes.PackageHashToBlobInfoMap) => {
        console.log(`Package processed, adding diff info`);
        addDiffInfoForPackage(accountId, appId, deploymentId, appPackage, diffPackageMap);
      });
  }

  return router;
}
