// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as q from "q";
import { createClient, RedisClientType } from "redis";

import Promise = q.Promise;

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
  // An incomplete set of promisified versions of the original redis methods
  public del: (...key: string[]) => Promise<number>;
  public execBatch: (redisBatchClient: any) => Promise<any[]>;
  public exists: (...key: string[]) => Promise<number>;
  public expire: (key: string, seconds: number) => Promise<number>;
  public hdel: (key: string, field: string) => Promise<number>;
  public hget: (key: string, field: string) => Promise<string>;
  public hgetall: (key: string) => Promise<any>;
  public hincrby: (key: string, field: string, value: number) => Promise<number>;
  public hset: (key: string, field: string, value: string) => Promise<number>;
  public ping: (payload?: any) => Promise<any>;
  public quit: () => Promise<void>;
  public select: (databaseNumber: number) => Promise<void>;
  public set: (key: string, value: string) => Promise<void>;

  constructor(redisClient: RedisClientType) {
    this.del = (...keys) => redisClient.del(keys);
    this.exists = (...keys) => redisClient.exists(keys);
    this.expire = (key, seconds) => redisClient.expire(key, seconds);
    this.hdel = (key, field) => redisClient.hDel(key, field);
    this.hget = (key, field) => redisClient.hGet(key, field);
    this.hgetall = (key) => redisClient.hGetAll(key);
    this.hincrby = (key, field, value) => redisClient.hIncrBy(key, field, value);
    this.hset = (key, field, value) => redisClient.hSet(key, field, value);
    this.ping = (payload) => redisClient.ping(payload);
    this.quit = () => redisClient.quit();
    this.select = (databaseNumber) => redisClient.select(databaseNumber);
    this.set = (key, value) => redisClient.set(key, value);
    
    this.execBatch = async (redisBatchClient: any) => {
      const results = await redisBatchClient.exec();
      return results;
    };
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
    const hostAndPortPassed = process.env.REDIS_HOST && process.env.REDIS_PORT;
    const connectionPassed = process.env.REDIS_CONN_STRING;

    if (connectionPassed || hostAndPortPassed) {
      const redisConfig = connectionPassed
        ? {
            url: process.env.REDIS_CONN_STRING,
            socket: {
              tls: true,
              rejectUnauthorized: true,
              connectTimeout: 10000,
            },
          }
        : {
            url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
            password: process.env.REDIS_KEY,
            socket: {
              tls: true,
              rejectUnauthorized: true,
            },
          };

      this._opsClient = createClient(redisConfig);
      this._metricsClient = createClient(redisConfig);

      this._opsClient.on("error", (err) => console.error("Redis Ops Error:", err));
      this._metricsClient.on("error", (err) => console.error("Redis Metrics Error:", err));

      // New Redis client requires explicit connect
      q.all([this._opsClient.connect(), this._metricsClient.connect()]).catch((err) => console.error("Redis connection error:", err));

      this._promisifiedOpsClient = new PromisifiedRedisClient(this._opsClient);
      this._promisifiedMetricsClient = new PromisifiedRedisClient(this._metricsClient);
      this._setupMetricsClientPromise = this._promisifiedMetricsClient
        .select(RedisManager.METRICS_DB)
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
      .then(async () => {
        const multi = this._metricsClient.multi();
        const currentDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(currentDeploymentKey);
        const currentLabelActiveField: string = Utilities.getLabelActiveCountField(currentLabel);
        const currentLabelDeploymentSucceededField: string = Utilities.getLabelStatusField(currentLabel, DEPLOYMENT_SUCCEEDED);
        
        multi.hIncrBy(currentDeploymentKeyLabelsHash, currentLabelActiveField, 1);
        multi.hIncrBy(currentDeploymentKeyLabelsHash, currentLabelDeploymentSucceededField, 1);

        if (previousDeploymentKey && previousLabel) {
          const previousDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(previousDeploymentKey);
          const previousLabelActiveField: string = Utilities.getLabelActiveCountField(previousLabel);
          multi.hIncrBy(previousDeploymentKeyLabelsHash, previousLabelActiveField, -1);
        }

        return this._promisifiedMetricsClient.execBatch(multi);
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
        const batchClient: any = (<any>this._metricsClient).batch();
        const deploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        const toLabelActiveField: string = Utilities.getLabelActiveCountField(toLabel);

        batchClient.hset(deploymentKeyClientsHash, clientUniqueId, toLabel);
        batchClient.hincrby(deploymentKeyLabelsHash, toLabelActiveField, /* incrementBy */ 1);
        if (fromLabel) {
          const fromLabelActiveField: string = Utilities.getLabelActiveCountField(fromLabel);
          batchClient.hincrby(deploymentKeyLabelsHash, fromLabelActiveField, /* incrementBy */ -1);
        }

        return this._promisifiedMetricsClient.execBatch(batchClient);
      })
      .then(() => {});
  }
}
