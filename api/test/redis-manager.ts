// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as q from "q";
import * as shortid from "shortid";
import Promise = q.Promise;

import { RedisManager, CacheableResponse } from "../script/redis-manager";

class DummyExpressResponse {
  public statusCode: number;
  public body: string;
  public locals: Object;

  public status(statusCode: number): DummyExpressResponse {
    assert(!this.statusCode);
    this.statusCode = statusCode;
    return this;
  }

  public send(body: string): DummyExpressResponse {
    assert(!this.body);
    this.body = body;
    return this;
  }

  public reset(): void {
    delete this.statusCode;
    delete this.body;
    this.locals = {};
  }
}

var redisManager: RedisManager = new RedisManager();

if (!redisManager.isEnabled) {
  console.log("Redis is not configured... Skipping redis tests");
} else {
  describe("Redis Cache", redisTests);
}

function redisTests() {
  var dummyExpressResponse: DummyExpressResponse = new DummyExpressResponse();
  var expectedResponse: CacheableResponse = {
    statusCode: 200,
    body: "",
  };
  var responseGenerator = (): Promise<CacheableResponse | void> => {
    return q(expectedResponse);
  };

  after(() => {
    return redisManager.close();
  });

  it("should be healthy by default", () => {
    return redisManager.checkHealth();
  });

  it("first cache request should return null", () => {
    var expiryKey: string = "test:" + shortid.generate();
    var url: string = shortid.generate();
    return redisManager.getCachedResponse(expiryKey, url).then((cacheResponse: CacheableResponse) => {
      assert.strictEqual(cacheResponse, null);
    });
  });

  it("Should get cache request after setting it once", () => {
    var expiryKey: string = "test:" + shortid.generate();
    var url: string = shortid.generate();
    expectedResponse.statusCode = 200;
    expectedResponse.body = "I am cached";

    return redisManager
      .getCachedResponse(expiryKey, url)
      .then((cacheResponse: CacheableResponse) => {
        assert.strictEqual(cacheResponse, null);
        return redisManager.setCachedResponse(expiryKey, url, expectedResponse);
      })
      .then(() => {
        return redisManager.getCachedResponse(expiryKey, url);
      })
      .then((cacheResponse: CacheableResponse) => {
        assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
        assert.equal(cacheResponse.body, expectedResponse.body);
        return redisManager.getCachedResponse(expiryKey, url);
      })
      .then((cacheResponse: CacheableResponse) => {
        assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
        assert.equal(cacheResponse.body, expectedResponse.body);
        var newUrl: string = shortid.generate();
        return redisManager.getCachedResponse(expiryKey, newUrl);
      })
      .then((cacheResponse: CacheableResponse) => {
        assert.strictEqual(cacheResponse, null);
      });
  });

  it("should be able to invalidate cached request", () => {
    var expiryKey: string = "test:" + shortid.generate();
    var url: string = shortid.generate();
    expectedResponse.statusCode = 200;
    expectedResponse.body = "I am cached";

    return redisManager
      .getCachedResponse(expiryKey, url)
      .then((cacheResponse: CacheableResponse) => {
        assert.strictEqual(cacheResponse, null);
        return redisManager.setCachedResponse(expiryKey, url, expectedResponse);
      })
      .then(() => {
        return redisManager.getCachedResponse(expiryKey, url);
      })
      .then((cacheResponse: CacheableResponse) => {
        assert.equal(cacheResponse.statusCode, expectedResponse.statusCode);
        assert.equal(cacheResponse.body, expectedResponse.body);
        expectedResponse.body = "I am a new body";
        return redisManager.invalidateCache(expiryKey);
      })
      .then(() => {
        return redisManager.getCachedResponse(expiryKey, url);
      })
      .then((cacheResponse: CacheableResponse) => {
        assert.strictEqual(cacheResponse, null);
      });
  });
}
