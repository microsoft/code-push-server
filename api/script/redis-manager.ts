// redis-manager.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";
import { Cluster, ClusterOptions, Redis, ClusterNode } from "ioredis";
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

  export function getLabelStatusField(label: string, status: string): string | null {
    if (isValidDeploymentStatus(status)) {
      return `${label}:${status}`;
    } else {
      return null;
    }
  }

  export function getLabelActiveCountField(label: string): string | null {
    if (label) {
      return `${label}:${ACTIVE}`;
    } else {
      return null;
    }
  }

  export function getDeploymentKeyHash(deploymentKey: string): string {
    return `deploymentKey:${deploymentKey}`;
  }

  export function getDeploymentKeyLabelsHash(deploymentKey: string): string {
    return `deploymentKeyLabels:${deploymentKey}`;
  }

  export function getDeploymentKeyClientsHash(deploymentKey: string): string {
    return `deploymentKeyClients:${deploymentKey}`;
  }
}

export class RedisManager {
  private static DEFAULT_EXPIRY: number = 3600; // one hour, specified in seconds
  private _opsClient: Cluster | Redis;
  private _metricsClient: Cluster | Redis;

  private _setupMetricsClientPromise: Promise<void> | null = null;

  constructor() {
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      console.log("port redis:", process.env.REDIS_PORT);
      const redisConfig = {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
        // auth_pass: process.env.REDIS_KEY,
        // tls: {
        //   // Note: Node defaults CA's to those trusted by Mozilla
        //   rejectUnauthorized: true,
        // },
      };

      const clusterRetryStrategy = (times: number): number | null => {
        // Customize retry logic; return null to stop retrying
        if (times > 5) {
          console.error("Too many retries. Giving up.");
          return null;
        }
        return Math.min(times * 100, 3000); // Incremental delay
      };

      const options: ClusterOptions = {
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
          port: parseInt(process.env.REDIS_PORT, 10),
        },
      ];

      console.log("REDIS_CLUSTER_ENABLED:", process.env.REDIS_CLUSTER_ENABLED);
      console.log("Type of REDIS_CLUSTER_ENABLED:", typeof process.env.REDIS_CLUSTER_ENABLED);
      const clusterEnabled = process.env.REDIS_CLUSTER_ENABLED === "true";
      console.log("Cluster Enabled:", clusterEnabled);

      if (clusterEnabled) {
        console.log("startUpNodes, options", startUpNodes, options);
      } else {
        console.log("Redis config since no cluster enabled:", redisConfig);
      }

      this._opsClient = clusterEnabled
        ? new Cluster(startUpNodes, options)
        : new Redis(redisConfig);

      this._metricsClient = clusterEnabled
        ? new Cluster(startUpNodes, options)
        : new Redis(redisConfig);

      this._opsClient.on("error", (err: Error) => {
        console.error("Redis ops client error:", err);
      });

      this._metricsClient.on("error", (err: Error) => {
        console.error("Redis Metrics client error:", err);
      });

      // Initialize metrics client health
      this._setupMetricsClientPromise = this._metricsClient
        .set("health", "healthy")
        .then(() => {
          console.log("Initial health status set to 'healthy'.");
        })
        .catch((err: Error) => {
          console.error("Failed to set initial health status:", err);
        });
    }

    // Ensure that _opsClient and _metricsClient are defined if Redis is not enabled
    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
      console.warn("No REDIS_HOST or REDIS_PORT environment variable configured.");
      this._opsClient = null;
      this._metricsClient = null;
      this._setupMetricsClientPromise = null;
    }
  }

  public get isEnabled(): boolean {
    return !!this._opsClient && !!this._metricsClient;
  }

  public async checkHealth(): Promise<void> {
    if (!this.isEnabled) {
      throw new Error("Redis manager is not enabled");
    }

    console.log("Starting Redis health check...");
    try {
      await Promise.all([
        this._opsClient.ping().then(() => console.log("Ops Client Ping successful")),
        this._metricsClient.ping().then(() => console.log("Metrics Client Ping successful")),
      ]);
      console.log("Redis health check passed.");
    } catch (err) {
      console.error("Redis health check failed:", err);
      sendErrorToDatadog(err);
      throw err;
    }
  }

  /**
   * Get a response from cache if possible, otherwise return null.
   * @param expiryKey: An identifier to get cached response if not expired
   * @param url: The url of the request to cache
   * @return The object of type CacheableResponse or null
   */
  public async getCachedResponse(expiryKey: string, url: string): Promise<CacheableResponse | null> {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const serializedResponse = await this._opsClient.hget(expiryKey, url);
      if (serializedResponse) {
        const response: CacheableResponse = JSON.parse(serializedResponse);
        return response;
      } else {
        return null;
      }
    } catch (error) {
      console.error(`Error getting cached response for key: ${expiryKey}, url: ${url}`, error);
      throw error;
    }
  }

  /**
   * Set a response in redis cache for given expiryKey and url.
   * @param expiryKey: An identifier that you can later use to expire the cached response
   * @param url: The url of the request to cache
   * @param response: The response to cache
   */
  public async setCachedResponse(expiryKey: string, url: string, response: CacheableResponse): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      const serializedResponse: string = JSON.stringify(response);
      const isExisting: number = await this._opsClient.exists(expiryKey);
      const isNewKey: boolean = isExisting === 0;

      await this._opsClient.hset(expiryKey, url, serializedResponse);

      if (isNewKey) {
        await this._opsClient.expire(expiryKey, RedisManager.DEFAULT_EXPIRY);
      }
    } catch (error) {
      console.error(`Error setting cached response for key: ${expiryKey}, url: ${url}`, error);
      throw error;
    }
  }

  public async invalidateCache(expiryKey: string): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this._opsClient.del(expiryKey);
    } catch (error) {
      console.error(`Error invalidating cache for key: ${expiryKey}`, error);
      throw error;
    }
  }

  /**
   * Atomically increments the status field for the deployment by 1,
   * or 1 by default. If the field does not exist, it will be created with the value of 1.
   */
  public async incrementLabelStatusCount(deploymentKey: string, label: string, status: string): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const hash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
    const field: string | null = Utilities.getLabelStatusField(label, status);

    if (!field) {
      throw new Error(`Invalid deployment status: ${status}`);
    }

    try {
      await this._setupMetricsClientPromise;
      await this._metricsClient.hincrby(hash, field, 1);
    } catch (error) {
      console.error(`Error incrementing label status count for deploymentKey: ${deploymentKey}, label: ${label}, status: ${status}`, error);
      throw error;
    }
  }

  public async clearMetricsForDeploymentKey(deploymentKey: string): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this._setupMetricsClientPromise;
      await this._metricsClient.del(Utilities.getDeploymentKeyLabelsHash(deploymentKey));
      await this._metricsClient.del(Utilities.getDeploymentKeyClientsHash(deploymentKey));
    } catch (error) {
      console.error(`Error clearing metrics for deploymentKey: ${deploymentKey}`, error);
      throw error;
    }
  }

  /**
   * Retrieves metrics for a specific deployment key.
   * Returns an object mapping labelStatus to their counts.
   */
  public async getMetricsWithDeploymentKey(deploymentKey: string): Promise<DeploymentMetrics | null> {
    if (!this.isEnabled) {
      return null;
    }

    try {
      await this._setupMetricsClientPromise;
      const metrics = await this._metricsClient.hgetall(Utilities.getDeploymentKeyLabelsHash(deploymentKey));

      if (metrics && Object.keys(metrics).length > 0) {
        const parsedMetrics: DeploymentMetrics = {};
        for (const key in metrics) {
          if (metrics.hasOwnProperty(key)) {
            const value = metrics[key];
            const numberValue = Number(value);
            if (!isNaN(numberValue)) {
              parsedMetrics[key] = numberValue;
            } else {
              console.warn(`Invalid number for key: ${key}, value: ${value}`);
            }
          }
        }
        return parsedMetrics;
      } else {
        return null;
      }
    } catch (error) {
      console.error(`Error getting metrics for deploymentKey: ${deploymentKey}`, error);
      throw error;
    }
  }

  /**
   * Records an update by incrementing the appropriate fields.
   */
  public async recordUpdate(
    currentDeploymentKey: string,
    currentLabel: string,
    previousDeploymentKey?: string,
    previousLabel?: string
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this._setupMetricsClientPromise;
      const pipeline = this._metricsClient.pipeline();

      const currentDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(currentDeploymentKey);
      const currentLabelActiveField: string | null = Utilities.getLabelActiveCountField(currentLabel);
      const currentLabelDeploymentSucceededField: string | null = Utilities.getLabelStatusField(currentLabel, DEPLOYMENT_SUCCEEDED);

      if (currentLabelActiveField) {
        pipeline.hincrby(currentDeploymentKeyLabelsHash, currentLabelActiveField, 1);
      }

      if (currentLabelDeploymentSucceededField) {
        pipeline.hincrby(currentDeploymentKeyLabelsHash, currentLabelDeploymentSucceededField, 1);
      }

      if (previousDeploymentKey && previousLabel) {
        const previousDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(previousDeploymentKey);
        const previousLabelActiveField: string | null = Utilities.getLabelActiveCountField(previousLabel);
        if (previousLabelActiveField) {
          pipeline.hincrby(previousDeploymentKeyLabelsHash, previousLabelActiveField, -1);
        }
      }

      await pipeline.exec();
    } catch (error) {
      console.error(`Error recording update from deploymentKey: ${currentDeploymentKey} to ${currentLabel}`, error);
      throw error;
    }
  }

  /**
   * Removes the active label for a client in a deployment.
   */
  public async removeDeploymentKeyClientActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this._setupMetricsClientPromise;
      await this._metricsClient.hdel(Utilities.getDeploymentKeyClientsHash(deploymentKey), clientUniqueId);
    } catch (error) {
      console.error(`Error removing active label for deploymentKey: ${deploymentKey}, clientUniqueId: ${clientUniqueId}`, error);
      throw error;
    }
  }

  // For unit tests only
  public async close(): Promise<void> {
    if (!this._opsClient && !this._metricsClient) return;

    try {
      if (this._opsClient) {
        await this._opsClient.quit();
      }
      if (this._metricsClient) {
        await this._metricsClient.quit();
      }
    } catch (error) {
      console.error("Error closing Redis clients:", error);
      throw error;
    }
  }

  /* deprecated */
  public async getCurrentActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<string | null> {
    if (!this.isEnabled) {
      return null;
    }

    try {
      await this._setupMetricsClientPromise;
      const label = await this._metricsClient.hget(Utilities.getDeploymentKeyClientsHash(deploymentKey), clientUniqueId);
      return label;
    } catch (error) {
      console.error(`Error getting current active label for deploymentKey: ${deploymentKey}, clientUniqueId: ${clientUniqueId}`, error);
      throw error;
    }
  }

  /* deprecated */
  public async updateActiveAppForClient(
    deploymentKey: string,
    clientUniqueId: string,
    toLabel: string,
    fromLabel?: string
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this._setupMetricsClientPromise;
      const pipeline = this._metricsClient.pipeline();

      const deploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
      const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
      const toLabelActiveField: string | null = Utilities.getLabelActiveCountField(toLabel);

      if (toLabelActiveField) {
        pipeline.hset(deploymentKeyClientsHash, clientUniqueId, toLabel);
        pipeline.hincrby(deploymentKeyLabelsHash, toLabelActiveField, 1);
      }

      if (fromLabel) {
        const fromLabelActiveField: string | null = Utilities.getLabelActiveCountField(fromLabel);
        if (fromLabelActiveField) {
          // First, check the current value before decrementing
          const currentValue = await this._metricsClient.hget(deploymentKeyLabelsHash, fromLabelActiveField);
          const currentCount = currentValue ? parseInt(currentValue, 10) : 0;

          if (currentCount > 0) {
            pipeline.hincrby(deploymentKeyLabelsHash, fromLabelActiveField, -1);
          } else {
            console.warn(`Attempted to decrement ${fromLabelActiveField}, but it is already 0.`);
          }
        }
      }

      await pipeline.exec();
    } catch (error) {
      console.error(`Error updating active app for clientUniqueId: ${clientUniqueId} in deploymentKey: ${deploymentKey}`, error);
      throw error;
    }
  }
}
