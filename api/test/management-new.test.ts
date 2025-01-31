// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as fs from "fs";
import * as path from "path";
import * as request from "supertest";

import * as defaultServer from "../script/default-server";
import * as redis from "../script/redis-manager";
import * as storage from "../script/storage/storage";
import * as testUtils from "./utils.test";

import { AzureStorage } from "../script/storage/azure-storage";
import { JsonStorage } from "../script/storage/json-storage";

const ACCESS_KEY_MASKING_STRING = "(hidden)";

function managementTests(useJsonStorage?: boolean): void {
  let server: express.Express | undefined;
  let serverUrl: string | undefined;
  let storageInstance: storage.Storage;
  let redisManager: redis.RedisManager;
  let account: storage.Account;
  let otherAccount: storage.Account;
  let accessKey: storage.AccessKey;

  const isTestingMetrics = !!(process.env.REDIS_HOST && process.env.REDIS_PORT);

  beforeAll(async () => {
    try {
      account = testUtils.makeAccount();
      otherAccount = testUtils.makeAccount();

      if (process.env.AZURE_MANAGEMENT_URL) {
        serverUrl = process.env.AZURE_MANAGEMENT_URL;
        storageInstance = useJsonStorage ? new JsonStorage() : new AzureStorage();
      } else {
        const startServer = (): Promise<void> =>
          new Promise((resolve, reject) => {
            defaultServer.start((err: Error | null, app: express.Express, serverStorage: storage.Storage) => {
              if (err) return reject(err);
              server = app;
              storageInstance = serverStorage;
              resolve();
            }, useJsonStorage);
          });

        await startServer();
      }

      await storageInstance.addAccount(account).then((id) => {
        account.id = id;
      });

      await storageInstance.addAccount(otherAccount).then((id) => {
        otherAccount.id = id;
      });

      accessKey = testUtils.makeStorageAccessKey();
      await storageInstance.addAccessKey(account.id, accessKey).then((id) => {
        accessKey.id = id;
      });

      cleanupTestResources();

      redisManager = new redis.RedisManager();
    } catch (error) {
      console.error("Error during setup:", error);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      await redisManager.close();

      if (storageInstance instanceof JsonStorage) {
        await storageInstance.dropAll();
      }
    } catch (error) {
      console.error("Error during teardown:", error);
    }
  });

  describe("GET authenticated", () => {
    it("returns 200 if logged in", (done) => {
      GET("/authenticated", () => done(), 200);
    });

    // it("returns unauthorized if invalidly formatted key", (done) => {
    //   GET("/authenticated", () => done(), 401, "$%");
    // });

    // it("returns unauthorized if key does not exist", (done) => {
    //   GET("/authenticated", () => done(), 401, "thisaccesskeydoesnotexist");
    // });
  });

  describe("GET account", () => {
    it("returns existing account", (done) => {
      GET("/account", (response: any) => {
        assert.equal(response.account.name, account.name);
        done();
      });
    });

    it("returns unauthorized if not logged in", (done) => {
      GET("/account", () => done(), 401, "thisaccesskeydoesnotexist");
    });
  });

  // Helper functions
  function GET(
    url: string,
    callback: (response: any, headers: any) => void,
    expect: number = 200,
    accessKeyOverride?: string
  ): void {
    request(server || serverUrl)
      .get(url)
      .expect(expect)
    //   .set("Authorization", `Bearer ${accessKeyOverride || accessKey.name}`)
      .end((err, result) => {
        if (err) throw err;

        let response;
        try {
          response = result.text ? JSON.parse(result.text) : null;
        } catch {
          // Ignore JSON parse error for empty responses
        }

        callback(response, result.headers);
      });
  }

  function cleanupTestResources(): void {
    const resourcesDirectory = path.join(__dirname, "resources");
    const files = fs.readdirSync(resourcesDirectory);

    files.forEach((file) => {
      if (file.startsWith("temp_")) {
        try {
          fs.unlinkSync(path.join(resourcesDirectory, file));
        } catch {
          // Ignore errors during cleanup
        }
      }
    });
  }
}

// Conditionally run tests based on the environment
if (!process.env.AZURE_MANAGEMENT_URL) {
  describe("Management Rest API with JSON Storage", () => managementTests(true));
}

if (process.env.TEST_AZURE_STORAGE) {
  describe("Management Rest API with Azure Storage", () => managementTests());
}
