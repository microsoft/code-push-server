// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as q from "q";
import * as redis from "@redis/client";

import Promise = q.Promise;
import { createClient, RedisClientType } from "redis";
import { RedisClientMultiCommandType } from "@redis/client/dist/lib/client/multi-command";

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

class PromisifiedRedisClient {
  private _redisClient: RedisClientType;

  public connect(): Promise<PromisifiedRedisClient> {
    return q.Promise<PromisifiedRedisClient>((resolve, reject) => {
      this._redisClient
        .connect()
        .then(() => resolve(this))
        .catch(reject);
    });
  }

  // An incomplete set of promisified versions of the original redis methods
  public del(...key: string[]): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient.del(key).then(resolve).catch(reject);
    });
  }

  public execBatch(redisBatchClient: RedisClientMultiCommandType<any, any, any>): Promise<any[]> {
    return q.Promise<any[]>((resolve, reject) => {
      redisBatchClient.exec().then(resolve).catch(reject);
    });
  }

  public exists(...key: string[]): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient.exists(key).then(resolve).catch(reject);
    });
  }

  public expire(key: string, seconds: number): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient
        .expire(key, seconds)
        .then(() => resolve(seconds))
        .catch(reject);
    });
  }

  public hdel(key: string, field: string): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient.hDel(key, field).then(resolve).catch(reject);
    });
  }

  public hget(key: string, field: string): Promise<string> {
    return q.Promise<string>((resolve, reject) => {
      this._redisClient.hGet(key, field).then(resolve).catch(reject);
    });
  }

  public hgetall(key: string): Promise<any> {
    return q.Promise<any>((resolve, reject) => {
      this._redisClient.hGetAll(key).then(resolve).catch(reject);
    });
  }

  public hincrby(key: string, field: string, value: number): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient.hIncrBy(key, field, value).then(resolve).catch(reject);
    });
  }

  public hset(key: string, field: string, value: string): Promise<number> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient.hSet(key, field, value).then(resolve).catch(reject);
    });
  }

  public ping(payload?: any): Promise<any> {
    return q.Promise<number>((resolve, reject) => {
      this._redisClient
        .ping(payload)
        .then(() => resolve())
        .catch(reject);
    });
  }

  public quit(): Promise<void> {
    return q.Promise<void>((resolve, reject) => {
      this._redisClient
        .quit()
        .then(() => resolve())
        .catch(reject);
    });
  }

  public select(databaseNumber: number): Promise<void> {
    return q.Promise<void>((resolve, reject) => {
      this._redisClient.select(databaseNumber).then(resolve).catch(reject);
    });
  }

  public set(key: string, value: string): Promise<void> {
    return q.Promise<void>((resolve, reject) => {
      this._redisClient
        .set(key, value)
        .then(() => resolve())
        .catch(reject);
    });
  }

  constructor(redisClient: RedisClientType) {
    this._redisClient = redisClient;
  }
}

export class RedisManager {
  private static DEFAULT_EXPIRY: number = 3600; // one hour, specified in seconds
  private static METRICS_DB: number = 1;

  private _opsClient: RedisClientType;
  private _promisifiedOpsClient: PromisifiedRedisClient;
  private _metricsClient: RedisClientType;
  private _promisifiedMetricsClient: PromisifiedRedisClient;
  private _setupMetricsClientPromise: Promise<void>;

  constructor() {
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      const redisConfig = {
        // no security (rediss) for now
        url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
        password: process.env.REDIS_KEY,
        // TODO add values from RedisSocketCommonOptions to handle connect timeout and reconnect settings
      };
      this._opsClient = redis.createClient(redisConfig);
      this._metricsClient = createClient(redisConfig);

      this._metricsClient.multi();

      // TODO find better way to do it
      this._opsClient.connect();

      this._opsClient.on("error", (err: Error) => {
        console.error(err);
      });

      this._metricsClient.on("error", (err: Error) => {
        console.error(err);
      });

      this._promisifiedOpsClient = new PromisifiedRedisClient(this._opsClient);
      this._promisifiedMetricsClient = new PromisifiedRedisClient(this._metricsClient);
      this._setupMetricsClientPromise = this._promisifiedMetricsClient
        .connect()
        .then((connected) => connected.select(RedisManager.METRICS_DB))
        .then(() => this._promisifiedMetricsClient.set("health", "health"));
    } else {
      console.warn("No REDIS_HOST or REDIS_PORT environment variable configured.");
    }
  }

  public get isEnabled(): boolean {
    return !!this._opsClient && !!this._metricsClient;
  }

  public checkHealth(): Promise<void> {
    if (!this.isEnabled) {
      return q.reject<void>("Redis manager is not enabled");
    }

    return q.all([this._promisifiedOpsClient.ping(), this._promisifiedMetricsClient.ping()]).spread<void>(() => {});
  }

  /**
   * Get a response from cache if possible, otherwise return null.
   * @param expiryKey: An identifier to get cached response if not expired
   * @param url: The url of the request to cache
   * @return The object of type CacheableResponse
   */
  public getCachedResponse(expiryKey: string, url: string): Promise<CacheableResponse> {
    if (!this.isEnabled) {
      return q<CacheableResponse>(null);
    }

    return this._promisifiedOpsClient.hget(expiryKey, url).then((serializedResponse: string): Promise<CacheableResponse> => {
      if (serializedResponse) {
        const response = <CacheableResponse>JSON.parse(serializedResponse);
        return q<CacheableResponse>(response);
      } else {
        return q<CacheableResponse>(null);
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
      return q<void>(null);
    }

    // Store response in cache with a timed expiry
    const serializedResponse: string = JSON.stringify(response);
    let isNewKey: boolean;
    return this._promisifiedOpsClient
      .exists(expiryKey)
      .then((isExisting: number) => {
        isNewKey = !isExisting;
        return this._promisifiedOpsClient.hset(expiryKey, url, serializedResponse);
      })
      .then(() => {
        if (isNewKey) {
          return this._promisifiedOpsClient.expire(expiryKey, RedisManager.DEFAULT_EXPIRY);
        }
      })
      .then(() => {});
  }

  // Atomically increments the status field for the deployment by 1,
  // or 1 by default. If the field does not exist, it will be created with the value of 1.
  public incrementLabelStatusCount(deploymentKey: string, label: string, status: string): Promise<void> {
    if (!this.isEnabled) {
      return q(<void>null);
    }

    const hash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
    const field: string = Utilities.getLabelStatusField(label, status);

    return this._setupMetricsClientPromise.then(() => this._promisifiedMetricsClient.hincrby(hash, field, 1)).then(() => {});
  }

  public clearMetricsForDeploymentKey(deploymentKey: string): Promise<void> {
    if (!this.isEnabled) {
      return q(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() =>
        this._promisifiedMetricsClient.del(
          Utilities.getDeploymentKeyLabelsHash(deploymentKey),
          Utilities.getDeploymentKeyClientsHash(deploymentKey)
        )
      )
      .then(() => {});
  }

  // Promised return value will look something like
  // { "v1:DeploymentSucceeded": 123, "v1:DeploymentFailed": 4, "v1:Active": 123 ... }
  public getMetricsWithDeploymentKey(deploymentKey: string): Promise<DeploymentMetrics> {
    if (!this.isEnabled) {
      return q(<DeploymentMetrics>null);
    }

    return this._setupMetricsClientPromise
      .then(() => this._promisifiedMetricsClient.hgetall(Utilities.getDeploymentKeyLabelsHash(deploymentKey)))
      .then((metrics) => {
        // Redis returns numerical values as strings, handle parsing here.
        if (metrics) {
          Object.keys(metrics).forEach((metricField) => {
            if (!isNaN(metrics[metricField])) {
              metrics[metricField] = +metrics[metricField];
            }
          });
        }

        return <DeploymentMetrics>metrics;
      });
  }

  public recordUpdate(currentDeploymentKey: string, currentLabel: string, previousDeploymentKey?: string, previousLabel?: string) {
    if (!this.isEnabled) {
      return q(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        // TODO validate difference between batch() and multi()
        // see https://github.com/redis/node-redis/pull/878/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5
        // there is no  batch(); in new version of redis client
        //const batchClient: any = (<any>this._metricsClient).batch();
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

        return this._promisifiedMetricsClient.execBatch(batchClient);
      })
      .then(() => {});
  }

  public removeDeploymentKeyClientActiveLabel(deploymentKey: string, clientUniqueId: string) {
    if (!this.isEnabled) {
      return q(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        return this._promisifiedMetricsClient.hdel(deploymentKeyClientsHash, clientUniqueId);
      })
      .then(() => {});
  }

  public invalidateCache(expiryKey: string): Promise<void> {
    if (!this.isEnabled) return q(<void>null);

    return this._promisifiedOpsClient.del(expiryKey).then(() => {});
  }

  // For unit tests only
  public close(): Promise<void> {
    const promiseChain: Promise<void> = q(<void>null);
    if (!this._opsClient && !this._metricsClient) return promiseChain;

    return promiseChain
      .then(() => this._opsClient && this._promisifiedOpsClient.quit())
      .then(() => this._metricsClient && this._promisifiedMetricsClient.quit())
      .then(() => <void>null);
  }

  /* deprecated */
  public getCurrentActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<string> {
    if (!this.isEnabled) {
      return q(<string>null);
    }

    return this._setupMetricsClientPromise.then(() =>
      this._promisifiedMetricsClient.hget(Utilities.getDeploymentKeyClientsHash(deploymentKey), clientUniqueId)
    );
  }

  /* deprecated */
  public updateActiveAppForClient(deploymentKey: string, clientUniqueId: string, toLabel: string, fromLabel?: string): Promise<void> {
    if (!this.isEnabled) {
      return q(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        // TODO validate difference between batch() and multi()
        // see https://github.com/redis/node-redis/pull/878/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5
        // there is no  batch(); in new version of redis client
        //const batchClient: any = (<any>this._metricsClient).batch();
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

        return this._promisifiedMetricsClient.execBatch(batchClient);
      })
      .then(() => {});
  }
}
