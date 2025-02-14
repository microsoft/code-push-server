// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
// import * as redis from "redis";
import { Cluster, ClusterOptions, Redis, ClusterNode } from "ioredis"

import { ClusterConfig } from "aws-sdk/clients/opensearch";
import { type } from "os";
import { sendErrorToDatadog } from "./utils/tracer";

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
  private client: Redis | Cluster;

  constructor(client: Redis | Cluster) {
    this.client = client;
  }

  /** Set a key in Redis with an optional expiry */
  public async set(key: string, value: string, expiry?: number): Promise<void> {
    try {
      if (expiry) {
        await this.client.set(key, value, "EX", expiry);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      console.error(`Redis SET error for key: ${key}`, error);
      throw error;
    }
  }

  /** Get a value from Redis */
  public async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error(`Redis GET error for key: ${key}`, error);
      return null;
    }
  }

  /** Check if keys exist */
  public async exists(...keys: string[]): Promise<number> {
    try {
      return await this.client.exists(...keys);
    } catch (error) {
      console.error(`Redis EXISTS error for keys: ${keys.join(", ")}`, error);
      return 0;
    }
  }

  /** Get a field from a Redis hash */
  public async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch (error) {
      console.error(`Redis HGET error for key: ${key}, field: ${field}`, error);
      return null;
    }
  }

  /** Delete a field from a Redis hash */
  public async hdel(key: string, field: string): Promise<number> {
    try {
      return await this.client.hdel(key, field);
    } catch (error) {
      console.error(`Redis HDEL error for key: ${key}, field: ${field}`, error);
      return 0;
    }
  }

  /** Set a field in a Redis hash */
  public async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hset(key, field, value);
    } catch (error) {
      console.error(`Redis HSET error for key: ${key}, field: ${field}`, error);
      return 0;
    }
  }

  /** Delete a key */
  public async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error(`Redis DEL error for key: ${key}`, error);
      return 0;
    }
  }

  /** Ping Redis to check connection */
  public async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      console.error("Redis PING error", error);
      return "ERROR";
    }
  }

  /** Get all fields and values in a Redis hash */
  public async hgetall(key: string): Promise<Record<string, string>> {
    try {
      console.log(`Fetching all fields for key: ${key}`);
      return await this.client.hgetall(key);
    } catch (error) {
      console.error(`Redis HGETALL error for key: ${key}`, error);
      return {};
    }
  }

  /** Expire a key after a given number of seconds */
  public async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      console.error(`Redis EXPIRE error for key: ${key}`, error);
      return 0;
    }
  }

  /** Increment a field in a Redis hash */
  public async hincrby(key: string, field: string, incrementBy: number): Promise<number> {
    try {
      return await this.client.hincrby(key, field, incrementBy);
    } catch (error) {
      console.error(`Redis HINCRBY error for key: ${key}, field: ${field}`, error);
      return 0;
    }
  }

  /** Quit the Redis client */
  public async quit(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      console.error("Error while closing Redis connection", error);
    }
  }

  /** Batch Execution using Redis Pipelining */
  public async execBatch(commands: Array<[string, ...any[]]>): Promise<any[]> {
    try {
      const pipeline = this.client.pipeline();
      commands.forEach((cmd) => pipeline[cmd[0]](...cmd.slice(1)));
      return await pipeline.exec();
    } catch (error) {
      console.error("Redis batch execution error", error);
      return [];
    }
  }
}

export class RedisManager {
  private static DEFAULT_EXPIRY: number = 3600; // one hour, specified in seconds
  private _opsClient: Cluster | Redis = null;
  private _promisifiedOpsClient: PromisifiedRedisClient | null = null;

  private _metricsClient: Cluster | Redis = null;
  private _promisifiedMetricsClient: PromisifiedRedisClient | null = null;

  private _setupMetricsClientPromise: Promise<void> | null = null;

  constructor() {
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      console.log("port redis:", process.env.REDIS_PORT);
      const redisConfig = {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
        // auth_pass: process.env.REDIS_KEY,
        // tls: {
        //   // Note: Node defaults CA's to those trusted by Mozilla
        //   rejectUnauthorized: true,
        // },
      };


      const clusterRetryStrategy = (times) => {
        // Customize retry logic; return null to stop retrying
        if (times > 5) {
          console.error("Too many retries. Giving up.");
          return null;
        }
        return Math.min(times * 100, 3000); // Incremental delay
      };

      const options : ClusterOptions = {   
        redisOptions: {
          connectTimeout: 15000, // Timeout for initial connection (in ms)
          maxRetriesPerRequest: 5, // Max retries for a failed request
        },
        scaleReads: "all", // All reads go to master
        clusterRetryStrategy: clusterRetryStrategy,
      };

      const startUpNodes: ClusterNode[] = [
          {
            host: process.env.REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT),
          },
      ]


      console.log("value ",process.env.REDIS_CLUSTER_ENABLED)
      console.log("typeof ", typeof process.env.REDIS_CLUSTER_ENABLED)
      const clusterEnabledWithDoubleEqual = process.env.REDIS_CLUSTER_ENABLED == "true";
      const clusterEnabledWithTrippleEqual = process.env.REDIS_CLUSTER_ENABLED === "true";
      console.log("clusterEnabledWithDoubleEqual", clusterEnabledWithDoubleEqual);
      console.log("clusterEnabledWithTrippleEqual", clusterEnabledWithTrippleEqual);

      if (process.env.REDIS_CLUSTER_ENABLED == "true") {
        console.log("startUpNodes, options", startUpNodes, options);
      } else {
        console.log("Redis config since no cluster enabled:", redisConfig);
      }
      this._opsClient = process.env.REDIS_CLUSTER_ENABLED == "true" ? new Cluster(startUpNodes, options) : new Redis(redisConfig);
      this._metricsClient = process.env.REDIS_CLUSTER_ENABLED == "true" ? new Cluster(startUpNodes, options) : new Redis(redisConfig);
      this._opsClient.on("error", (err: Error) => {
        console.error("Redis ops client error:", err);
      });

      this._metricsClient.on("error", (err: Error) => {
        console.error("Redis Metrics client error:", err);
      });

      this._promisifiedOpsClient = new PromisifiedRedisClient(this._opsClient);
      this._promisifiedMetricsClient = new PromisifiedRedisClient(this._metricsClient);
      this._setupMetricsClientPromise = this._promisifiedMetricsClient
        .set("health", "healthy")
        .then(() => {})
        .catch((err) => console.error("Failed to set initial health status:", err));
    } else {
      console.warn("No REDIS_HOST or REDIS_PORT environment variable configured.");
    }
  }

  public get isEnabled(): boolean {
    return !!this._opsClient && !!this._metricsClient;
  }

  public checkHealth(): Promise<void> {
    if (!this.isEnabled) {
      return Promise.reject<void>("Redis manager is not enabled");
    }

    console.log("Starting Redis health check...");
    return Promise
      .all([
        this._promisifiedOpsClient.ping().then(() => console.log("Ops Client Ping successful")),
        this._promisifiedMetricsClient.ping().then(() => console.log("Metrics Client Ping successful")),
      ])
      .then(() => {
        console.log("Redis health check passed.");
      })
      .catch((err) => {
        console.error("Redis health check failed:", err);
        sendErrorToDatadog(err);
        throw err;
      });
  }

  /**
   * Get a response from cache if possible, otherwise return null.
   * @param expiryKey: An identifier to get cached response if not expired
   * @param url: The url of the request to cache
   * @return The object of type CacheableResponse
   */
  public getCachedResponse(expiryKey: string, url: string): Promise<CacheableResponse> {
    if (!this.isEnabled) {
      return Promise.resolve(<CacheableResponse>(null));
    }

    return this._promisifiedOpsClient.hget(expiryKey, url).then((serializedResponse: string): Promise<CacheableResponse> => {
      if (serializedResponse) {
        const response = <CacheableResponse>JSON.parse(serializedResponse);
        return Promise.resolve(<CacheableResponse>(response));
      } else {
        return Promise.resolve(<CacheableResponse>(null));
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
      return Promise.resolve(<void>(null));
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

  public invalidateCache(expiryKey: string): Promise<void> {
    
    if (!this.isEnabled) return Promise.resolve(<void>null);

    return this._promisifiedOpsClient.del(expiryKey).then(() => {});
  }

  // Atomically increments the status field for the deployment by 1,
  // or 1 by default. If the field does not exist, it will be created with the value of 1.
  public incrementLabelStatusCount(deploymentKey: string, label: string, status: string): Promise<void> {
    if (!this.isEnabled) {
      return Promise.resolve(<void>null);
    }

    const hash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
    const field: string = Utilities.getLabelStatusField(label, status);

    return this._setupMetricsClientPromise.then(() => this._promisifiedMetricsClient.hincrby(hash, field, 1)).then(() => {});
  }

  public clearMetricsForDeploymentKey(deploymentKey: string): Promise<void> {
    if (!this.isEnabled) {
      return Promise.resolve(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() =>
        this._promisifiedMetricsClient.del(
          Utilities.getDeploymentKeyLabelsHash(deploymentKey)
        )
      ).then(() => 
        this._promisifiedMetricsClient.del(
          Utilities.getDeploymentKeyClientsHash(deploymentKey)
        )
      )
      .then(() => {});
  }

  // Promised return value will look something like
  // { "v1:DeploymentSucceeded": 123, "v1:DeploymentFailed": 4, "v1:Active": 123 ... }
  public getMetricsWithDeploymentKey(deploymentKey: string): Promise<DeploymentMetrics> {
    if (!this.isEnabled) {
      return Promise.resolve(<DeploymentMetrics>null);
    }

    return this._setupMetricsClientPromise
    .then(() => this._promisifiedMetricsClient.hgetall(Utilities.getDeploymentKeyLabelsHash(deploymentKey)))
    .then((metrics) => {
      if (metrics) {
        const parsedMetrics: Record<string, number> = {};
  
        Object.keys(metrics).forEach((metricField) => {
          const value = Number(metrics[metricField]);
          parsedMetrics[metricField] = isNaN(value) ? 0 : value; // Handle NaN cases safely
        });
  
        return parsedMetrics as DeploymentMetrics; // Ensure it matches DeploymentMetrics type
      }
  
      return {} as DeploymentMetrics; // Handle empty case safely
    });  
  }

  public recordUpdate(currentDeploymentKey: string, currentLabel: string, previousDeploymentKey?: string, previousLabel?: string) {
    if (!this.isEnabled) {
      return Promise.resolve(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const batchClient: any = (<any>this._metricsClient).pipeline();
        const currentDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(currentDeploymentKey);
        const currentLabelActiveField: string = Utilities.getLabelActiveCountField(currentLabel);
        const currentLabelDeploymentSucceededField: string = Utilities.getLabelStatusField(currentLabel, DEPLOYMENT_SUCCEEDED);
        batchClient.hincrby(currentDeploymentKeyLabelsHash, currentLabelActiveField, /* incrementBy */ 1);
        batchClient.hincrby(currentDeploymentKeyLabelsHash, currentLabelDeploymentSucceededField, /* incrementBy */ 1);

        if (previousDeploymentKey && previousLabel) {
          const previousDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(previousDeploymentKey);
          const previousLabelActiveField: string = Utilities.getLabelActiveCountField(previousLabel);
          batchClient.hincrby(previousDeploymentKeyLabelsHash, previousLabelActiveField, /* incrementBy */ -1);
        }

        return batchClient.exec(batchClient);
      })
      .then(() => {});
  }

  public removeDeploymentKeyClientActiveLabel(deploymentKey: string, clientUniqueId: string) {
    if (!this.isEnabled) {
      return Promise.resolve(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        return this._promisifiedMetricsClient.hdel(deploymentKeyClientsHash, clientUniqueId);
      })
      .then(() => {});
  }

  // For unit tests only
  public close(): Promise<void> {
    const promiseChain: Promise<void> = Promise.resolve(<void>null);
    if (!this._opsClient && !this._metricsClient) return promiseChain;

    return promiseChain
      .then(() => this._opsClient && this._promisifiedOpsClient.quit())
      .then(() => this._metricsClient && this._promisifiedMetricsClient.quit())
      .then(() => <void>null);
  }

  /* deprecated */
  public getCurrentActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<string> {
    if (!this.isEnabled) {
      return Promise.resolve(<string>null);
    }

    return this._setupMetricsClientPromise.then(() =>
      this._promisifiedMetricsClient.hget(Utilities.getDeploymentKeyClientsHash(deploymentKey), clientUniqueId)
    );
  }

  /* deprecated */
  public updateActiveAppForClient(deploymentKey: string, clientUniqueId: string, toLabel: string, fromLabel?: string): Promise<void> {
    if (!this.isEnabled) {
      return Promise.resolve(<void>null);
    }

    return this._setupMetricsClientPromise
      .then(() => {
        const batchClient: any = (<any>this._metricsClient).pipeline();
        const deploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        const toLabelActiveField: string = Utilities.getLabelActiveCountField(toLabel);

        batchClient.hset(deploymentKeyClientsHash, clientUniqueId, toLabel);
        batchClient.hincrby(deploymentKeyLabelsHash, toLabelActiveField, /* incrementBy */ 1);
        if (fromLabel) {
          const fromLabelActiveField: string = Utilities.getLabelActiveCountField(fromLabel);
          batchClient.hincrby(deploymentKeyLabelsHash, fromLabelActiveField, /* incrementBy */ -1);
        }

        return batchClient.exec(batchClient);
      })
      .then(() => {});
  }
}
