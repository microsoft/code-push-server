// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as shortid from "shortid";
import { RedisManager, CacheableResponse } from "../script/redis-manager";

class DummyExpressResponse {
  public statusCode?: number;
  public body?: string;
  public locals: Record<string, unknown> = {};

  public status(statusCode: number): DummyExpressResponse {
    assert(!this.statusCode, "Status code already set");
    this.statusCode = statusCode;
    return this;
  }

  public send(body: string): DummyExpressResponse {
    assert(!this.body, "Body already set");
    this.body = body;
    return this;
  }

  public reset(): void {
    this.statusCode = undefined;
    this.body = undefined;
    this.locals = {};
  }
}

const redisManager = new RedisManager();
const dummyExpressResponse = new DummyExpressResponse();
const expectedResponse: CacheableResponse = {
  statusCode: 200,
  body: "",
};

describe("Redis Cache Middleware", () => {
  beforeAll(async () => {
    if (!redisManager.isEnabled) {
      console.log("Redis is not configured... Skipping Redis tests");
    }
  });

  afterAll(async () => {
    await redisManager.close();
  });

  it("should be healthy by default", async () => {
    await redisManager.checkHealth();
  });

  it("first cache request should return null", async () => {
    const expiryKey = `test:${shortid.generate()}`;
    const url = shortid.generate();
    const cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse).toBeNull();
  });

  it("should get cache request after setting it once", async () => {
    const expiryKey = `test:${shortid.generate()}`;
    const url = shortid.generate();
    expectedResponse.statusCode = 200;
    expectedResponse.body = "I am cached";

    let cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse).toBeNull();

    await redisManager.setCachedResponse(expiryKey, url, expectedResponse);

    cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse?.statusCode).toBe(expectedResponse.statusCode);
    expect(cacheResponse?.body).toBe(expectedResponse.body);

    const newUrl = shortid.generate();
    cacheResponse = await redisManager.getCachedResponse(expiryKey, newUrl);
    expect(cacheResponse).toBeNull();
  });

  it("should be able to invalidate cached request", async () => {
    const expiryKey = `test:${shortid.generate()}`;
    const url = shortid.generate();
    expectedResponse.statusCode = 200;
    expectedResponse.body = "I am cached";

    let cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse).toBeNull();

    await redisManager.setCachedResponse(expiryKey, url, expectedResponse);

    cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse?.statusCode).toBe(expectedResponse.statusCode);
    expect(cacheResponse?.body).toBe(expectedResponse.body);

    expectedResponse.body = "I am a new body";
    await redisManager.invalidateCache(expiryKey);

    cacheResponse = await redisManager.getCachedResponse(expiryKey, url);
    expect(cacheResponse).toBeNull();
  });
});
