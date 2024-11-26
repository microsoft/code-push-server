// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as Redis from "redis";

export const DEPLOYMENT_SUCCEEDED = "DeploymentSucceeded";
export const DEPLOYMENT_FAILED = "DeploymentFailed";
export const ACTIVE = "Active";
export const DOWNLOADED = "Downloaded";

export interface CacheableResponse {
  statusCode: number;
  body: any;
}

export interface DeploymentMetrics {
  [labelStatus: string]: number;
}

export module Utilities {
  export function isValidDeploymentStatus(status: string): boolean {
    return status === DEPLOYMENT_SUCCEEDED || status === DEPLOYMENT_FAILED || status === DOWNLOADED;
  }

  export function getLabelStatusField(label: string, status: string): string {
    if (isValidDeploymentStatus(status)) {
      return label + ":" + status;
    } else {
      return null;
    }
  }

  export function getLabelActiveCountField(label: string): string {
    if (label) {
      return label + ":" + ACTIVE;
    } else {
      return null;
    }
  }

  export function getDeploymentKeyHash(deploymentKey: string): string {
    return "deploymentKey:" + deploymentKey;
  }

  export function getDeploymentKeyLabelsHash(deploymentKey: string): string {
    return "deploymentKeyLabels:" + deploymentKey;
  }

  export function getDeploymentKeyClientsHash(deploymentKey: string): string {
    return "deploymentKeyClients:" + deploymentKey;
  }
}

export class RedisManager {
  private static DEFAULT_EXPIRY: number = 3600; // one hour, specified in seconds
  private static METRICS_DB: number = 1;

  private _opsClient: Redis.RedisClientType;
  private _metricsClient: Redis.RedisClientType;
  private _setupMetricsClientPromise: Promise<string | void>;

  public initialize() {
    if (process.env.REDIS_URL) {
      const redisConfig = {
        url: process.env.REDIS_URL,
      };
      this._opsClient = Redis.createClient(redisConfig);
      this._metricsClient = Redis.createClient(redisConfig);

      this._opsClient.connect();
      this._metricsClient.connect();

      this._opsClient.on("error", (err: Error) => {
        console.error(err);
      });

      this._metricsClient.on("error", (err: Error) => {
        console.error(err);
      });

      this._setupMetricsClientPromise = this._metricsClient
        .select(RedisManager.METRICS_DB)
        .then(() => this._metricsClient.set("health", "health"));
    } else {
      console.warn("No REDIS_URL environment variable configured.");
    }
  }

  public get isEnabled(): boolean {
    return !!this._opsClient && !!this._metricsClient;
  }

  public checkHealth() {
    if (!this.isEnabled) {
      return Promise.reject("Redis manager is not enabled");
    }

    return Promise.all([this._opsClient.ping(), this._metricsClient.ping()]).catch(() => {});
  }

  /**
   * Get a response from cache if possible, otherwise return null.
   * @param expiryKey: An identifier to get cached response if not expired
   * @param url: The url of the request to cache
   * @return The object of type CacheableResponse
   */
  public getCachedResponse(expiryKey: string, url: string): Promise<CacheableResponse> {
    if (!this.isEnabled) {
      return null;
    }

    return this._opsClient.hGet(expiryKey, url).then((serializedResponse: string): Promise<CacheableResponse> => {
      if (serializedResponse) {
        const response = <CacheableResponse>JSON.parse(serializedResponse);
        return Promise.resolve(response);
      } else {
        return null;
      }
    });
  }

  /**
   * Set a response in redis cache for given expiryKey and url.
   * @param expiryKey: An identifier that you can later use to expire the cached response
   * @param url: The url of the request to cache
   * @param response: The response to cache
   */
  public setCachedResponse(expiryKey: string, url: string, response: CacheableResponse): Promise<void> {
    if (!this.isEnabled) {
      return null;
    }

    // Store response in cache with a timed expiry
    const serializedResponse: string = JSON.stringify(response);
    let isNewKey: boolean;
    return this._opsClient
      .exists(expiryKey)
      .then((isExisting: number) => {
        isNewKey = !isExisting;
        return this._opsClient.hSet(expiryKey, url, serializedResponse);
      })
      .then(() => {
        if (isNewKey) {
          return this._opsClient.expire(expiryKey, RedisManager.DEFAULT_EXPIRY);
        }
      })
      .then(() => {});
  }

  // Atomically increments the status field for the deployment by 1,
  // or 1 by default. If the field does not exist, it will be created with the value of 1.
  public incrementLabelStatusCount(deploymentKey: string, label: string, status: string): Promise<void> {
    if (!this.isEnabled) {
      return null;
    }

    const hash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
    const field: string = Utilities.getLabelStatusField(label, status);

    return this._setupMetricsClientPromise.then(() => this._metricsClient.hIncrBy(hash, field, 1)).then(() => {});
  }

  public clearMetricsForDeploymentKey(deploymentKey: string): Promise<void> {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise
      .then(() =>
        this._metricsClient.del([
          Utilities.getDeploymentKeyLabelsHash(deploymentKey),
          Utilities.getDeploymentKeyClientsHash(deploymentKey),
        ]),
      )
      .then(() => {});
  }

  // Promised return value will look something like
  // { "v1:DeploymentSucceeded": 123, "v1:DeploymentFailed": 4, "v1:Active": 123 ... }
  public getMetricsWithDeploymentKey(deploymentKey: string): Promise<DeploymentMetrics> {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise
      .then(() => this._metricsClient.hGetAll(Utilities.getDeploymentKeyLabelsHash(deploymentKey)))
      .then((metrics) => {
        // Redis returns numerical values as strings, handle parsing here.
        const newMetrics: DeploymentMetrics = {};
        if (metrics) {
          Object.keys(metrics).forEach((metricField) => {
            newMetrics[metricField] = +metrics[metricField];
          });
        }

        return newMetrics;
      });
  }

  public recordUpdate(currentDeploymentKey: string, currentLabel: string, previousDeploymentKey?: string, previousLabel?: string) {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const batchClient = this._metricsClient.multi();
        const currentDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(currentDeploymentKey);
        const currentLabelActiveField: string = Utilities.getLabelActiveCountField(currentLabel);
        const currentLabelDeploymentSucceededField: string = Utilities.getLabelStatusField(currentLabel, DEPLOYMENT_SUCCEEDED);
        batchClient.hIncrBy(currentDeploymentKeyLabelsHash, currentLabelActiveField, /* incrementBy */ 1);
        batchClient.hIncrBy(currentDeploymentKeyLabelsHash, currentLabelDeploymentSucceededField, /* incrementBy */ 1);

        if (previousDeploymentKey && previousLabel) {
          const previousDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(previousDeploymentKey);
          const previousLabelActiveField: string = Utilities.getLabelActiveCountField(previousLabel);
          batchClient.hIncrBy(previousDeploymentKeyLabelsHash, previousLabelActiveField, /* incrementBy */ -1);
        }

        return batchClient.exec();
      })
      .then(() => {});
  }

  public removeDeploymentKeyClientActiveLabel(deploymentKey: string, clientUniqueId: string) {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        return this._metricsClient.hDel(deploymentKeyClientsHash, clientUniqueId);
      })
      .then(() => {});
  }

  public invalidateCache(expiryKey: string): Promise<void> {
    if (!this.isEnabled) return null;

    return this._opsClient.del(expiryKey).then(() => {});
  }

  // For unit tests only
  public close(): Promise<void> {
    const promiseChain: Promise<void> = null;
    if (!this._opsClient && !this._metricsClient) return promiseChain;

    return promiseChain
      .then(() => this._opsClient && this._opsClient.quit())
      .then(() => this._metricsClient && this._metricsClient.quit())
      .then(() => <void>null);
  }

  /* deprecated */
  public getCurrentActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<string> {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise.then(() =>
      this._metricsClient.hGet(Utilities.getDeploymentKeyClientsHash(deploymentKey), clientUniqueId),
    );
  }

  /* deprecated */
  public updateActiveAppForClient(deploymentKey: string, clientUniqueId: string, toLabel: string, fromLabel?: string): Promise<void> {
    if (!this.isEnabled) {
      return null;
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const batchClient = this._metricsClient.multi();
        const deploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        const toLabelActiveField: string = Utilities.getLabelActiveCountField(toLabel);

        batchClient.hSet(deploymentKeyClientsHash, clientUniqueId, toLabel);
        batchClient.hIncrBy(deploymentKeyLabelsHash, toLabelActiveField, /* incrementBy */ 1);
        if (fromLabel) {
          const fromLabelActiveField: string = Utilities.getLabelActiveCountField(fromLabel);
          batchClient.hIncrBy(deploymentKeyLabelsHash, fromLabelActiveField, /* incrementBy */ -1);
        }

        return batchClient.exec();
      })
      .then(() => {});
  }
}
