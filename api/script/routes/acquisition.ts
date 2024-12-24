// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";
import * as semver from "semver";

import * as utils from "../utils/common";
import * as acquisitionUtils from "../utils/acquisition";
import * as errorUtils from "../utils/rest-error-handling";
import * as redis from "../redis-manager";
import * as restHeaders from "../utils/rest-headers";
import * as rolloutSelector from "../utils/rollout-selector";
import * as storageTypes from "../storage/storage";
import { UpdateCheckCacheResponse, UpdateCheckRequest, UpdateCheckResponse } from "../types/rest-definitions";
import * as validationUtils from "../utils/validation";

import * as q from "q";
import * as queryString from "querystring";
import * as URL from "url";
import Promise = q.Promise;

const METRICS_BREAKING_VERSION = "1.5.2-beta";

export interface AcquisitionConfig {
  storage: storageTypes.Storage;
  redisManager: redis.RedisManager;
}

function getUrlKey(originalUrl: string): string {
  const obj: any = URL.parse(originalUrl, /*parseQueryString*/ true);
  delete obj.query.clientUniqueId;
  return obj.pathname + "?" + queryString.stringify(obj.query);
}

function createResponseUsingStorage(
  req: express.Request,
  res: express.Response,
  storage: storageTypes.Storage
): Promise<redis.CacheableResponse> {
  const deploymentKey: string = String(req.query.deploymentKey || req.query.deployment_key);
  const appVersion: string = String(req.query.appVersion || req.query.app_version);
  const packageHash: string = String(req.query.packageHash || req.query.package_hash);
  const isCompanion: string = String(req.query.isCompanion || req.query.is_companion);

  const updateRequest: UpdateCheckRequest = {
    deploymentKey: deploymentKey,
    appVersion: appVersion,
    packageHash: packageHash,
    isCompanion: isCompanion && isCompanion.toLowerCase() === "true",
    label: String(req.query.label),
  };

  let originalAppVersion: string;

  // Make an exception to allow plain integer numbers e.g. "1", "2" etc.
  const isPlainIntegerNumber: boolean = /^\d+$/.test(updateRequest.appVersion);
  if (isPlainIntegerNumber) {
    originalAppVersion = updateRequest.appVersion;
    updateRequest.appVersion = originalAppVersion + ".0.0";
  }

  // Make an exception to allow missing patch versions e.g. "2.0" or "2.0-prerelease"
  const isMissingPatchVersion: boolean = /^\d+\.\d+([\+\-].*)?$/.test(updateRequest.appVersion);
  if (isMissingPatchVersion) {
    originalAppVersion = updateRequest.appVersion;
    const semverTagIndex = originalAppVersion.search(/[\+\-]/);
    if (semverTagIndex === -1) {
      updateRequest.appVersion += ".0";
    } else {
      updateRequest.appVersion = originalAppVersion.slice(0, semverTagIndex) + ".0" + originalAppVersion.slice(semverTagIndex);
    }
  }

  if (validationUtils.isValidUpdateCheckRequest(updateRequest)) {
    return storage.getPackageHistoryFromDeploymentKey(updateRequest.deploymentKey).then((packageHistory: storageTypes.Package[]) => {
      const updateObject: UpdateCheckCacheResponse = acquisitionUtils.getUpdatePackageInfo(packageHistory, updateRequest);
      if ((isMissingPatchVersion || isPlainIntegerNumber) && updateObject.originalPackage.appVersion === updateRequest.appVersion) {
        // Set the appVersion of the response to the original one with the missing patch version or plain number
        updateObject.originalPackage.appVersion = originalAppVersion;
        if (updateObject.rolloutPackage) {
          updateObject.rolloutPackage.appVersion = originalAppVersion;
        }
      }

      const cacheableResponse: redis.CacheableResponse = {
        statusCode: 200,
        body: updateObject,
      };

      return q(cacheableResponse);
    });
  } else {
    if (!validationUtils.isValidKeyField(updateRequest.deploymentKey)) {
      errorUtils.sendMalformedRequestError(
        res,
        "An update check must include a valid deployment key - please check that your app has been " +
          "configured correctly. To view available deployment keys, run 'code-push-standalone deployment ls <appName> -k'."
      );
    } else if (!validationUtils.isValidAppVersionField(updateRequest.appVersion)) {
      errorUtils.sendMalformedRequestError(
        res,
        "An update check must include a binary version that conforms to the semver standard (e.g. '1.0.0'). " +
          "The binary version is normally inferred from the App Store/Play Store version configured with your app."
      );
    } else {
      errorUtils.sendMalformedRequestError(
        res,
        "An update check must include a valid deployment key and provide a semver-compliant app version."
      );
    }

    return q<redis.CacheableResponse>(null);
  }
}

export function getHealthRouter(config: AcquisitionConfig): express.Router {
  const storage: storageTypes.Storage = config.storage;
  const redisManager: redis.RedisManager = config.redisManager;
  const router: express.Router = express.Router();

  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Health check endpoint
   *     description: Returns the health status of the service.
   *     responses:
   *       200:
   *         description: Service is healthy
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *               example: Healthy
   *       500:
   *         description: Internal server error
   */
  router.get("/health", (req: express.Request, res: express.Response, next: (err?: any) => void): any => {
    storage
      .checkHealth()
      .then(() => {
        return redisManager.checkHealth();
      })
      .then(() => {
        res.status(200).send("Healthy");
      })
      .catch((error: Error) => errorUtils.sendUnknownError(res, error, next))
      .done();
  });

  return router;
}

export function getAcquisitionRouter(config: AcquisitionConfig): express.Router {
  const storage: storageTypes.Storage = config.storage;
  const redisManager: redis.RedisManager = config.redisManager;
  const router: express.Router = express.Router();

  const updateCheck = function (newApi: boolean) {
    return function (req: express.Request, res: express.Response, next: (err?: any) => void) {
      const deploymentKey: string = String(req.query.deploymentKey || req.query.deployment_key);
      const key: string = redis.Utilities.getDeploymentKeyHash(deploymentKey);
      const clientUniqueId: string = String(req.query.clientUniqueId || req.query.client_unique_id);
      const url: string = getUrlKey(req.originalUrl);
      let fromCache: boolean = true;
      let redisError: Error;

      redisManager
        .getCachedResponse(key, url)
        .catch((error: Error) => {
          // Store the redis error to be thrown after we send response.
          redisError = error;
          return q<redis.CacheableResponse>(null);
        })
        .then((cachedResponse: redis.CacheableResponse) => {
          fromCache = !!cachedResponse;
          return cachedResponse || createResponseUsingStorage(req, res, storage);
        })
        .then((response: redis.CacheableResponse) => {
          if (!response) {
            return q<void>(null);
          }

          let giveRolloutPackage: boolean = false;
          const cachedResponseObject = <UpdateCheckCacheResponse>response.body;
          if (cachedResponseObject.rolloutPackage && clientUniqueId) {
            const releaseSpecificString: string =
              cachedResponseObject.rolloutPackage.label || cachedResponseObject.rolloutPackage.packageHash;
            giveRolloutPackage = rolloutSelector.isSelectedForRollout(
              clientUniqueId,
              cachedResponseObject.rollout,
              releaseSpecificString
            );
          }

          const updateCheckBody: { updateInfo: UpdateCheckResponse } = {
            updateInfo: giveRolloutPackage ? cachedResponseObject.rolloutPackage : cachedResponseObject.originalPackage,
          };

          // Change in new API
          updateCheckBody.updateInfo.target_binary_range = updateCheckBody.updateInfo.appVersion;

          res.locals.fromCache = fromCache;
          res.status(response.statusCode).send(newApi ? utils.convertObjectToSnakeCase(updateCheckBody) : updateCheckBody);

          // Update REDIS cache after sending the response so that we don't block the request.
          if (!fromCache) {
            return redisManager.setCachedResponse(key, url, response);
          }
        })
        .then(() => {
          if (redisError) {
            throw redisError;
          }
        })
        .catch((error: storageTypes.StorageError) => errorUtils.restErrorHandler(res, error, next))
        .done();
    };
  };

  const reportStatusDeploy = function (req: express.Request, res: express.Response, next: (err?: any) => void) {
    const deploymentKey = req.body.deploymentKey || req.body.deployment_key;
    const appVersion = req.body.appVersion || req.body.app_version;
    const previousDeploymentKey = req.body.previousDeploymentKey || req.body.previous_deployment_key || deploymentKey;
    const previousLabelOrAppVersion = req.body.previousLabelOrAppVersion || req.body.previous_label_or_app_version;
    const clientUniqueId = req.body.clientUniqueId || req.body.client_unique_id;

    if (!deploymentKey || !appVersion) {
      return errorUtils.sendMalformedRequestError(res, "A deploy status report must contain a valid appVersion and deploymentKey.");
    } else if (req.body.label) {
      if (!req.body.status) {
        return errorUtils.sendMalformedRequestError(res, "A deploy status report for a labelled package must contain a valid status.");
      } else if (!redis.Utilities.isValidDeploymentStatus(req.body.status)) {
        return errorUtils.sendMalformedRequestError(res, "Invalid status: " + req.body.status);
      }
    }

    const sdkVersion: string = restHeaders.getSdkVersion(req);
    if (semver.valid(sdkVersion) && semver.gte(sdkVersion, METRICS_BREAKING_VERSION)) {
      // If previousDeploymentKey not provided, assume it is the same deployment key.
      let redisUpdatePromise: q.Promise<void>;

      if (req.body.label && req.body.status === redis.DEPLOYMENT_FAILED) {
        redisUpdatePromise = redisManager.incrementLabelStatusCount(deploymentKey, req.body.label, req.body.status);
      } else {
        const labelOrAppVersion: string = req.body.label || appVersion;
        redisUpdatePromise = redisManager.recordUpdate(
          deploymentKey,
          labelOrAppVersion,
          previousDeploymentKey,
          previousLabelOrAppVersion
        );
      }

      redisUpdatePromise
        .then(() => {
          res.sendStatus(200);
          if (clientUniqueId) {
            redisManager.removeDeploymentKeyClientActiveLabel(previousDeploymentKey, clientUniqueId);
          }
        })
        .catch((error: any) => errorUtils.sendUnknownError(res, error, next))
        .done();
    } else {
      if (!clientUniqueId) {
        return errorUtils.sendMalformedRequestError(
          res,
          "A deploy status report must contain a valid appVersion, clientUniqueId and deploymentKey."
        );
      }

      return redisManager
        .getCurrentActiveLabel(deploymentKey, clientUniqueId)
        .then((currentVersionLabel: string) => {
          if (req.body.label && req.body.label !== currentVersionLabel) {
            return redisManager.incrementLabelStatusCount(deploymentKey, req.body.label, req.body.status).then(() => {
              if (req.body.status === redis.DEPLOYMENT_SUCCEEDED) {
                return redisManager.updateActiveAppForClient(deploymentKey, clientUniqueId, req.body.label, currentVersionLabel);
              }
            });
          } else if (!req.body.label && appVersion !== currentVersionLabel) {
            return redisManager.updateActiveAppForClient(deploymentKey, clientUniqueId, appVersion, appVersion);
          }
        })
        .then(() => {
          res.sendStatus(200);
        })
        .catch((error: any) => errorUtils.sendUnknownError(res, error, next))
        .done();
    }
  };

  const reportStatusDownload = function (req: express.Request, res: express.Response, next: (err?: any) => void) {
    const deploymentKey = req.body.deploymentKey || req.body.deployment_key;
    if (!req.body || !deploymentKey || !req.body.label) {
      return errorUtils.sendMalformedRequestError(
        res,
        "A download status report must contain a valid deploymentKey and package label."
      );
    }
    return redisManager
      .incrementLabelStatusCount(deploymentKey, req.body.label, redis.DOWNLOADED)
      .then(() => {
        res.sendStatus(200);
      })
      .catch((error: any) => errorUtils.sendUnknownError(res, error, next))
      .done();
  };

  /**
     * @openapi
     * /updateCheck:
     *   get:
     *     summary: Update check endpoint
     *     description: Checks for updates for the specified deployment key and app version.
     *     parameters:
     *       - name: deploymentKey
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The deployment key for the app.
   *       - name: clientUniqueId
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique client Identifier.
     *       - name: appVersion
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The version of the app.
     *       - name: packageHash
     *         in: query
     *         required: false
     *         schema:
     *           type: string
     *         description: The hash of the package.
     *       - name: isCompanion
     *         in: query
     *         required: false
     *         schema:
     *           type: boolean
     *         description: Indicates if the request is from a companion app.
     *       - name: label
     *         in: query
     *         required: false
     *         schema:
     *           type: string
     *         description: The label of the package.
     *     responses:
     *       200:
     *         description: Update information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 updateInfo:
     *                   type: object
     *                   properties:
     *                     appVersion:
     *                       type: string
     *                     description:
     *                       type: string
     *                     isDisabled:
     *                       type: boolean
     *                     isMandatory:
     *                       type: boolean
     *                     label:
     *                       type: string
     *                     packageHash:
     *                       type: string
     *                     rollout:
     *                       type: number
     *                     target_binary_range:
     *                       type: string
     *                     downloadURL:
     *                       type: string
     *                     isAvailable:
     *                       type: boolean
     *                     packageSize:
     *                       type: number
     *                     shouldRunBinaryVersion:
     *                       type: boolean
     *                     updateAppVersion:
     *                       type: boolean
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.get("/updateCheck", updateCheck(false));
  /**
     * @openapi
     * /v0.1/public/codepush/update_check:
     *   get:
     *     summary: Update check endpoint
     *     description: Checks for updates for the specified deployment key and app version.
     *     parameters:
     *       - name: deploymentKey
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The deployment key for the app.
     *       - name: clientUniqueId
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique client Identifier.
     *       - name: appVersion
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: The version of the app.
     *       - name: packageHash
     *         in: query
     *         required: false
     *         schema:
     *           type: string
     *         description: The hash of the package.
     *       - name: isCompanion
     *         in: query
     *         required: false
     *         schema:
     *           type: boolean
     *         description: Indicates if the request is from a companion app.
     *       - name: label
     *         in: query
     *         required: false
     *         schema:
     *           type: string
     *         description: The label of the package.
     *     responses:
     *       200:
     *         description: Update information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 updateInfo:
     *                   type: object
     *                   properties:
     *                     appVersion:
     *                       type: string
     *                     description:
     *                       type: string
     *                     isDisabled:
     *                       type: boolean
     *                     isMandatory:
     *                       type: boolean
     *                     label:
     *                       type: string
     *                     packageHash:
     *                       type: string
     *                     rollout:
     *                       type: number
     *                     target_binary_range:
     *                       type: string
     *                     downloadURL:
     *                       type: string
     *                     isAvailable:
     *                       type: boolean
     *                     packageSize:
     *                       type: number
     *                     shouldRunBinaryVersion:
     *                       type: boolean
     *                     updateAppVersion:
     *                       type: boolean
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.get("/v0.1/public/codepush/update_check", updateCheck(true));
  /**
     * @openapi
     * /reportStatus/deploy:
     *   post:
     *     summary: Report deployment status
     *     description: Reports the status of a deployment for the specified deployment key and app version.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               deploymentKey:
     *                 type: string
     *                 description: The deployment key for the app.
     *               appVersion:
     *                 type: string
     *                 description: The version of the app.
     *               previousDeploymentKey:
     *                 type: string
     *                 description: The previous deployment key.
     *               previousLabelOrAppVersion:
     *                 type: string
     *                 description: The previous label or app version.
     *               clientUniqueId:
     *                 type: string
     *                 description: The unique client identifier.
     *               label:
     *                 type: string
     *                 description: The label of the package.
     *               status:
     *                 type: string
     *                 description: The status of the deployment.
     *     responses:
     *       200:
     *         description: Deployment status reported successfully
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.post("/reportStatus/deploy", reportStatusDeploy);
  /**
     * @openapi
     * /v0.1/public/codepush/report_status/deploy:
     *   post:
     *     summary: Report deployment status
     *     description: Reports the status of a deployment for the specified deployment key and app version.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               deploymentKey:
     *                 type: string
     *                 description: The deployment key for the app.
     *               appVersion:
     *                 type: string
     *                 description: The version of the app.
     *               previousDeploymentKey:
     *                 type: string
     *                 description: The previous deployment key.
     *               previousLabelOrAppVersion:
     *                 type: string
     *                 description: The previous label or app version.
     *               clientUniqueId:
     *                 type: string
     *                 description: The unique client identifier.
     *               label:
     *                 type: string
     *                 description: The label of the package.
     *               status:
     *                 type: string
     *                 description: The status of the deployment.
     *     responses:
     *       200:
     *         description: Deployment status reported successfully
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.post("/v0.1/public/codepush/report_status/deploy", reportStatusDeploy);
  /**
     * @openapi
     * /reportStatus/download:
     *   post:
     *     summary: Report download status
     *     description: Reports the download status for the specified deployment key and package label.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               deploymentKey:
     *                 type: string
     *                 description: The deployment key for the app.
     *               label:
     *                 type: string
     *                 description: The label of the package.
     *     responses:
     *       200:
     *         description: Download status reported successfully
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.post("/reportStatus/download", reportStatusDownload);
  /**
     * @openapi
     * /v0.1/public/codepush/report_status/download:
     *   post:
     *     summary: Report download status
     *     description: Reports the download status for the specified deployment key and package label.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               deploymentKey:
     *                 type: string
     *                 description: The deployment key for the app.
     *               label:
     *                 type: string
     *                 description: The label of the package.
     *     responses:
     *       200:
     *         description: Download status reported successfully
     *       400:
     *         description: Invalid request parameters
     *       500:
     *         description: Internal server error
     */
  router.post("/v0.1/public/codepush/report_status/download", reportStatusDownload);

  return router;
}
