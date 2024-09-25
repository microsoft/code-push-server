// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as q from "q";
import * as queryString from "querystring";
import * as request from "supertest";
import Promise = q.Promise;

import * as defaultServer from "../script/default-server";
import * as storage from "../script/storage/storage";
import * as redis from "../script/redis-manager";
import * as utils from "./utils";

import { AzureStorage } from "../script/storage/azure-storage";
import { JsonStorage } from "../script/storage/json-storage";
import { UpdateCheckRequest } from "../script/types/rest-definitions";
import { SDK_VERSION_HEADER } from "../script/utils/rest-headers";

describe("Acquisition Rest API", () => {
  var account: storage.Account;
  var app: storage.App;
  var deployment: storage.Deployment;
  var appPackage: storage.Package;
  var previousPackageHash: string;
  var requestParameters: UpdateCheckRequest;
  var server: express.Express;
  var serverUrl: string;
  var storageInstance: storage.Storage;
  var redisManager: redis.RedisManager;
  var isAzureServer: boolean;

  before((): q.Promise<void> => {
    var useJsonStorage: boolean = !process.env.TEST_AZURE_STORAGE && !process.env.AZURE_ACQUISITION_URL;

    return q<void>(null)
      .then(() => {
        if (process.env.AZURE_ACQUISITION_URL) {
          serverUrl = process.env.AZURE_ACQUISITION_URL;
          isAzureServer = true;
          storageInstance = useJsonStorage ? new JsonStorage() : new AzureStorage();
        } else {
          var deferred: q.Deferred<void> = q.defer<void>();

          defaultServer.start(function (err: Error, app: express.Express, serverStorage: storage.Storage) {
            if (err) {
              deferred.reject(err);
            }

            server = app;
            storageInstance = serverStorage;
            deferred.resolve(null);
          }, useJsonStorage);

          return deferred.promise;
        }
      })
      .then(() => {
        account = utils.makeAccount();
        return storageInstance.addAccount(account);
      })
      .then((accountId: string) => {
        account.id = accountId;
        app = utils.makeStorageApp();
        return storageInstance.addApp(account.id, app);
      })
      .then((addedApp: storage.App) => {
        app.id = addedApp.id;
        deployment = utils.makeStorageDeployment();
        return storageInstance.addDeployment(account.id, app.id, deployment);
      })
      .then((deploymentId: string) => {
        deployment.id = deploymentId;
        appPackage = utils.makePackage();
        appPackage.blobUrl = "http://www.server.com/blob1";
        appPackage.diffPackageMap = { hash99: { url: "http://www.server.com/diffBlob1", size: 1 } };
        appPackage.description = "Test package for 1.0.0";
        appPackage.isMandatory = false;
        appPackage.packageHash = "hash100";
        appPackage.label = "v1";
        appPackage.appVersion = "1.0.0";
        appPackage.size = 2;
        deployment.package = appPackage;
        previousPackageHash = appPackage.packageHash;
        return storageInstance.commitPackage(account.id, app.id, deployment.id, deployment.package);
      })
      .then(() => {
        appPackage = utils.makePackage();
        appPackage.blobUrl = "http://www.server.com/blob2";
        appPackage.diffPackageMap = { [previousPackageHash]: { url: "http://www.server.com/diffBlob2", size: 3 } };
        appPackage.description = "Test package for 1.0.0";
        appPackage.isMandatory = true;
        appPackage.packageHash = "hash101";
        appPackage.label = "v2";
        appPackage.appVersion = "1.0.0";
        appPackage.size = 4;
        deployment.package = appPackage;
        previousPackageHash = appPackage.packageHash;
        return storageInstance.commitPackage(account.id, app.id, deployment.id, deployment.package);
      })
      .then(() => {
        appPackage = utils.makePackage();
        appPackage.blobUrl = "http://phs.googlecode.com/files/Download%20File%20Test.zip";
        appPackage.diffPackageMap = { [previousPackageHash]: { url: "http://www.server.com/diffBlob3", size: 5 } };
        appPackage.description = "Test package for 1.0.0";
        appPackage.isMandatory = false;
        appPackage.packageHash = "hash102";
        appPackage.label = "v3";
        appPackage.appVersion = "1.0.0";
        appPackage.size = 6;
        deployment.package = appPackage;
        return storageInstance.commitPackage(account.id, app.id, deployment.id, deployment.package);
      })
      .then(() => {
        redisManager = new redis.RedisManager();
      });
  });

  after((): Promise<void> => {
    return q(<void>null)
      .then(() => {
        if (storageInstance instanceof JsonStorage) {
          return storageInstance.dropAll();
        }
      })
      .then(() => {
        if (redisManager) {
          return redisManager.close();
        }
      });
  });

  describe("Get /health", () => {
    it("should be healthy if and only if correctly configured", (done) => {
      var isProductionReady: boolean = storageInstance instanceof AzureStorage && redisManager && redisManager.isEnabled;
      var expectedStatusCode: number = isProductionReady || isAzureServer ? 200 : 500;
      request(server || serverUrl)
        .get("/health")
        .expect(expectedStatusCode)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });
  });

  describe("Get /updateCheck", () => {
    var malformedURL: string = "Malformed URL";

    beforeEach((done) => {
      requestParameters = <UpdateCheckRequest>{
        deploymentKey: deployment.key,
        appVersion: "1.0.0",
        packageHash: "hash009",
        isCompanion: false,
      };

      done();
    });

    it("returns 400 for malformed URL without parameters", (done) => {
      request(server || serverUrl)
        .get("/updateCheck")
        .expect(400)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 400 for malformed URL with missing deploymentKey id parameter", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(400)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 400 for malformed URL with missing app version parameter", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
            })
        )
        .expect(400)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 400 for malformed URL with non-semver app version parameter", (done) => {
      requestParameters.appVersion = "notSemver";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(400)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 404 for incorrect deployment key", (done) => {
      requestParameters.deploymentKey = "keyThatIsNonExistent";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(404)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 400 for malformed deployment key", (done) => {
      requestParameters.deploymentKey = "keywith%character";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(400)
        .end(function (err: any, result: any) {
          if (err) throw err;
          done();
        });
    });

    it("returns 200 for deployment key with leading/trailing invalid characters", (done) => {
      requestParameters.deploymentKey = `\r\n\r\n${requestParameters.deploymentKey}\r\n\r\n`;
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          done();
        });
    });

    it("returns 200 and update for appVersion with missing patch version by assuming patch version of 0", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: "1.0",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          assert.equal(response.updateInfo.appVersion, "1.0");
          done();
        });
    });

    it("returns 200 and update for appVersion with missing patch version and build metadata by assuming patch version of 0", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: "1.0+metadata",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          // Semver ignores build metadata when matching against ranges
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          assert.equal(response.updateInfo.appVersion, "1.0+metadata");
          done();
        });
    });

    it("returns 200 and no update for appVersion with missing patch version and pre-release tag by assuming patch version of 0", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: "1.0-prerelease",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          // Semver pre-release tags don't match ranges unless explicitly specified
          assert.equal(response.updateInfo.isAvailable, false);
          assert.equal(response.updateInfo.updateAppVersion, true);
          assert.equal(response.updateInfo.appVersion, "1.0.0");
          done();
        });
    });

    it("returns 200 and available mandatory update for deployment key and app version but no package hash", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          done();
        });
    });

    it("returns 200 and available mandatory update for deployment key and app version and empty params", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
              packageHash: "",
              isCompanion: "",
              label: "",
              clientUniqueId: "",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          done();
        });
    });

    it("returns 200 and available optional update with diff blob URL", (done) => {
      requestParameters.deploymentKey = deployment.key;
      requestParameters.packageHash = previousPackageHash;
      requestParameters.appVersion = appPackage.appVersion;
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
              packageHash: requestParameters.packageHash,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.diffPackageMap[previousPackageHash].url);
          assert.equal(response.updateInfo.packageSize, 5);
          assert.equal(response.updateInfo.isMandatory, false);
          done();
        });
    });

    it("returns 200 and available mandatory update for different package hash", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          done();
        });
    });

    it("returns 200 and optional v3 update from v2 labelled request", (done) => {
      requestParameters.deploymentKey = deployment.key;
      requestParameters.packageHash = previousPackageHash;
      requestParameters.appVersion = appPackage.appVersion;
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
              packageHash: requestParameters.packageHash,
              label: "v2",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.diffPackageMap[previousPackageHash].url);
          assert.equal(response.updateInfo.packageSize, 5);
          assert.equal(response.updateInfo.isMandatory, false);
          assert.equal(response.updateInfo.label, "v3");
          done();
        });
    });

    it("returns 200 and mandatory v3 update from v1 labelled request", (done) => {
      requestParameters.deploymentKey = deployment.key;
      requestParameters.appVersion = appPackage.appVersion;
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              appVersion: requestParameters.appVersion,
              packageHash: requestParameters.packageHash,
              label: "v1",
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          assert.equal(response.updateInfo.isMandatory, true);
          assert.equal(response.updateInfo.label, "v3");
          done();
        });
    });

    it("returns 200 and available app update for lesser app version", (done) => {
      requestParameters.appVersion = "0.0.8";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, false);
          assert.equal(response.updateInfo.updateAppVersion, true);
          assert.equal(response.updateInfo.appVersion, appPackage.appVersion);
          done();
        });
    });

    it("returns 200 and no update for greater app version", (done) => {
      requestParameters.appVersion = "2.0.0";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, false);
          assert.equal(response.updateInfo.shouldRunBinaryVersion, true);
          assert.equal(response.updateInfo.updateAppVersion, false);
          done();
        });
    });

    it("returns 200 and available update for same app version, different package hashes, and isCompanion=false", (done) => {
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
              isCompanion: requestParameters.isCompanion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          done();
        });
    });

    it("returns 200 and available app update for lesser app version, different package hashes, and isCompanion=false", (done) => {
      requestParameters.appVersion = "0.1.0";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
              isCompanion: requestParameters.isCompanion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, false);
          assert.equal(response.updateInfo.updateAppVersion, true);
          assert.equal(response.updateInfo.appVersion, appPackage.appVersion);
          done();
        });
    });

    it("returns 200 and no update for greater app version, different package hashes, and isCompanion=false", (done) => {
      requestParameters.appVersion = "2.0.0";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
              isCompanion: requestParameters.isCompanion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, false);
          assert.equal(response.updateInfo.shouldRunBinaryVersion, true);
          assert.equal(response.updateInfo.updateAppVersion, false);
          assert.equal(response.updateInfo.appVersion, appPackage.appVersion);
          done();
        });
    });

    it("returns 200 and update for greater app version, different package hashes, and isCompanion=true", (done) => {
      requestParameters.isCompanion = true;
      requestParameters.appVersion = "2.0.0";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
              isCompanion: requestParameters.isCompanion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          done();
        });
    });

    it("returns 200 and update for lesser app version, different package hashes and isCompanion=true", (done) => {
      requestParameters.isCompanion = true;
      requestParameters.appVersion = "0.0.6";
      request(server || serverUrl)
        .get(
          "/updateCheck?" +
            queryString.stringify({
              deploymentKey: requestParameters.deploymentKey,
              packageHash: requestParameters.packageHash,
              appVersion: requestParameters.appVersion,
              isCompanion: requestParameters.isCompanion,
            })
        )
        .expect(200)
        .end(function (err: any, result: any) {
          if (err) throw err;
          var response = JSON.parse(result.text);
          assert.equal(response.updateInfo.isAvailable, true);
          assert.equal(response.updateInfo.downloadURL, appPackage.blobUrl);
          assert.equal(response.updateInfo.packageSize, 6);
          done();
        });
    });

    describe("Any binary can get an update", () => {
      var account2: storage.Account;
      var app2: storage.App;
      var deployment2: storage.Deployment;
      var package2: storage.Package;

      before(() => {
        account2 = utils.makeAccount();
        return storageInstance
          .addAccount(account2)
          .then((accountId: string) => {
            account2.id = accountId;
            app2 = utils.makeStorageApp();
            return storageInstance.addApp(account2.id, app2);
          })
          .then((addedApp: storage.App) => {
            app2.id = addedApp.id;
            deployment2 = utils.makeStorageDeployment();
            return storageInstance.addDeployment(account2.id, app2.id, deployment2);
          })
          .then((deploymentId: string) => {
            deployment2.id = deploymentId;
            package2 = utils.makePackage("1.0.0", /*isMandatory*/ false, "hash100", "v1");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("1.0.0", /*isMandatory*/ true, "hash101", "v2");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("2.0.0", /*isMandatory*/ false, "hash202", "v3");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("1.0.0", /*isMandatory*/ false, "hash103", "v4");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("3.0.0", /*isMandatory*/ true, "hash304", "v5");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("2.0.0", /*isMandatory*/ false, "hash205", "v6");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("3.0.0", /*isMandatory*/ false, "hash306", "v7");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          });
      });

      beforeEach((done) => {
        requestParameters = <UpdateCheckRequest>{
          deploymentKey: deployment2.key,
          appVersion: "1.0.0",
          packageHash: "hash100",
          isCompanion: false,
        };

        done();
      });

      it("returns 200 and latest available update for 1.0.0 binary", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "1.0.0");
            assert.equal(response.updateInfo.isMandatory, true);
            assert.equal(response.updateInfo.label, "v4");
            done();
          });
      });

      it("returns 200 and update available for 1.0.0 binary and earlier package hash", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "1.0.0");
            assert.equal(response.updateInfo.isMandatory, true);
            assert.equal(response.updateInfo.label, "v4");
            done();
          });
      });

      it("returns 200 and no update available for 1.0.0 binary on latest package", (done) => {
        requestParameters.packageHash = "hash103";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, false);
            assert.equal(response.updateInfo.updateAppVersion, true);
            assert.equal(response.updateInfo.appVersion, "3.0.0");
            done();
          });
      });

      it("returns 200 and update available for 2.0.0 binary for older package hash", (done) => {
        requestParameters.appVersion = "2.0.0";
        requestParameters.packageHash = "hash202";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "2.0.0");
            assert.equal(response.updateInfo.label, "v6");
            done();
          });
      });

      it("returns 200 and update available for 3.0.0 binary on older package hash", (done) => {
        requestParameters.appVersion = "3.0.0";
        requestParameters.packageHash = "hash304";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.isMandatory, false);
            assert.equal(response.updateInfo.appVersion, "3.0.0");
            assert.equal(response.updateInfo.label, "v7");
            done();
          });
      });

      it("returns 200 and no update available for 3.0.0 binary on latest package hash", (done) => {
        requestParameters.appVersion = "3.0.0";
        requestParameters.packageHash = "hash306";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, false);
            assert.equal(response.updateInfo.updateAppVersion, false);
            done();
          });
      });
    });

    describe("Updates can target a range of binary versions", () => {
      var account2: storage.Account;
      var app2: storage.App;
      var deployment2: storage.Deployment;
      var package2: storage.Package;

      before(() => {
        account2 = utils.makeAccount();
        return storageInstance
          .addAccount(account2)
          .then((accountId: string) => {
            account2.id = accountId;
            app2 = utils.makeStorageApp();
            return storageInstance.addApp(account2.id, app2);
          })
          .then((addedApp: storage.App) => {
            app2.id = addedApp.id;
            deployment2 = utils.makeStorageDeployment();
            return storageInstance.addDeployment(account2.id, app2.id, deployment2);
          })
          .then((deploymentId: string) => {
            deployment2.id = deploymentId;
            package2 = utils.makePackage("*", /*isMandatory*/ false, "hash100", "v1");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("^1.0.0", /*isMandatory*/ true, "hash101", "v2");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage(">=1.1.0 <1.2.0", /*isMandatory*/ false, "hash103", "v3");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          });
      });

      beforeEach((done) => {
        requestParameters = <UpdateCheckRequest>{
          deploymentKey: deployment2.key,
          appVersion: "2.0.0",
          packageHash: "hash100",
          isCompanion: false,
        };

        done();
      });

      it("returns 200 and update targeting all versions for 2.0.0 binary", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "2.0.0");
            assert.equal(response.updateInfo.isMandatory, false);
            assert.equal(response.updateInfo.label, "v1");
            done();
          });
      });

      it("returns 200 and update targeting major version 1 and minor version 0 and any patch version for 1.0.1 binary", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                appVersion: "1.0.1",
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "1.0.1");
            assert.equal(response.updateInfo.isMandatory, true);
            assert.equal(response.updateInfo.label, "v2");
            done();
          });
      });

      it("returns 200, no update available, and the binary update notification for a 0.0.1 binary that already got the latest applicable package hash", (done) => {
        requestParameters.packageHash = "hash100";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: "0.0.1",
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, false);
            assert.equal(response.updateInfo.updateAppVersion, true);
            assert.equal(response.updateInfo.appVersion, ">=1.1.0 <1.2.0");
            done();
          });
      });

      it("returns 200 and no update available for a 3.0.0 binary that already got the latest applicable package hash", (done) => {
        requestParameters.packageHash = "hash100";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: "3.0.0",
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, false);
            assert.equal(response.updateInfo.updateAppVersion, false);
            done();
          });
      });

      it("returns 200 and update available for 1.1.5 binary with older package hash", (done) => {
        requestParameters.appVersion = "1.1.5";
        requestParameters.packageHash = "hash100";
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                packageHash: requestParameters.packageHash,
                appVersion: requestParameters.appVersion,
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "1.1.5");
            assert.equal(response.updateInfo.label, "v3");
            done();
          });
      });
    });

    describe("Disabled updates are ignored completely", () => {
      var account2: storage.Account;
      var app2: storage.App;
      var deployment2: storage.Deployment;
      var package2: storage.Package;

      before(() => {
        account2 = utils.makeAccount();
        return storageInstance
          .addAccount(account2)
          .then((accountId: string) => {
            account2.id = accountId;
            app2 = utils.makeStorageApp();
            return storageInstance.addApp(account2.id, app2);
          })
          .then((addedApp: storage.App) => {
            app2.id = addedApp.id;
            deployment2 = utils.makeStorageDeployment();
            return storageInstance.addDeployment(account2.id, app2.id, deployment2);
          })
          .then((deploymentId: string) => {
            deployment2.id = deploymentId;
            package2 = utils.makePackage("*", /*isMandatory*/ true, "hash100", "v1");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("*", /*isMandatory*/ false, "hash100", "v2");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("*", /*isMandatory*/ true, "hash101", "v3");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            package2 = utils.makePackage("2.0.0", /*isMandatory*/ false, "hash102", "v4");
            deployment2.package = package2;
            return storageInstance.commitPackage(account2.id, app2.id, deployment2.id, deployment2.package);
          })
          .then(() => {
            return storageInstance.getPackageHistory(account2.id, app2.id, deployment2.id);
          })
          .then((packageHistory: storage.Package[]) => {
            packageHistory[2].isDisabled = true;
            return storageInstance.updatePackageHistory(account2.id, app2.id, deployment2.id, packageHistory);
          });
      });

      beforeEach((done) => {
        requestParameters = <UpdateCheckRequest>{
          deploymentKey: deployment2.key,
          appVersion: "2.0.0",
          isCompanion: false,
        };

        done();
      });

      it("returns 200 and v2 update since v3 is disabled and v4 does not target 1.0.0", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                deploymentKey: requestParameters.deploymentKey,
                appVersion: "1.0.0",
                isCompanion: requestParameters.isCompanion,
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, "1.0.0");
            assert.equal(response.updateInfo.isMandatory, true);
            assert.equal(response.updateInfo.label, "v2");
            done();
          });
      });

      it("returns 200 and v4 update for 2.0.0 binary running v1, isMandatory flag from v3 disabled update should not apply", (done) => {
        request(server || serverUrl)
          .get(
            "/updateCheck?" +
              queryString.stringify({
                appVersion: requestParameters.appVersion,
                deploymentKey: requestParameters.deploymentKey,
                isCompanion: requestParameters.isCompanion,
                label: "v1",
                packageHash: "hash100",
              })
          )
          .expect(200)
          .end(function (err: any, result: any) {
            if (err) throw err;
            var response = JSON.parse(result.text);
            assert.equal(response.updateInfo.isAvailable, true);
            assert.equal(response.updateInfo.appVersion, requestParameters.appVersion);
            assert.equal(response.updateInfo.isMandatory, false);
            assert.equal(response.updateInfo.label, "v4");
            done();
          });
      });
    });
  });

  describe("Metrics Tests", () => {
    beforeEach(() => {
      deployment = utils.makeStorageDeployment();
      return storageInstance.addDeployment(account.id, app.id, deployment).then((deploymentId: string) => {
        deployment.id = deploymentId;
      });
    });

    describe("POST /reportStatus/deploy", () => {
      it("returns 400 if invalid json is sent", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .send("{invalid: json")
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if deploymentKey is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              status: redis.DEPLOYMENT_SUCCEEDED,
              label: "v2",
              clientUniqueId: "My iPhone",
              appVersion: "1.0.0",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if clientUniqueId is unspecified and SDK version is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
              status: redis.DEPLOYMENT_SUCCEEDED,
              label: "v2",
              appVersion: "1.0.0",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if clientUniqueId is unspecified and SDK version is <=1.5.1-beta", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .set(SDK_VERSION_HEADER, "1.5.1-beta")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
              status: redis.DEPLOYMENT_SUCCEEDED,
              label: "v2",
              appVersion: "1.0.0",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if appVersion is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
              status: redis.DEPLOYMENT_SUCCEEDED,
              label: "v2",
              clientUniqueId: "My iPhone",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if deploymentKey, label, clientUniqueId and appVersion is specified but status is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/deploy")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
              label: "v2",
              clientUniqueId: "My iPhone",
              appVersion: "1.0.0",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 200 and increments the correct counters in Redis if SDK version is unspecified", (done) => {
        function sendReport(statusReport: string): Promise<void> {
          return Promise<void>((resolve, reject) => {
            request(server || serverUrl)
              .post("/reportStatus/deploy")
              .set("Content-Type", "application/json")
              .send(statusReport)
              .expect(200)
              .end((err: any, result: any): void => {
                if (err) {
                  reject(err);
                }

                resolve(<void>null);
              });
          });
        }

        return sendReport(
          JSON.stringify({
            deploymentKey: deployment.key,
            clientUniqueId: "My iPhone",
            appVersion: "1.0.0",
          })
        )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                status: redis.DEPLOYMENT_SUCCEEDED,
                label: "v2",
                clientUniqueId: "My iPhone",
                appVersion: "1.0.0",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                clientUniqueId: "My Android",
                appVersion: "1.0.0",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                status: redis.DEPLOYMENT_FAILED,
                label: "v3",
                clientUniqueId: "My Android",
                appVersion: "1.0.0",
              })
            )
          )
          .then(() => {
            if (redisManager.isEnabled) {
              return redisManager.getMetricsWithDeploymentKey(deployment.key).then((metrics: any) => {
                assert.equal(metrics[redis.Utilities.getLabelActiveCountField("1.0.0")], 1);
                assert.equal(metrics[redis.Utilities.getLabelActiveCountField("v2")], 1);
                assert.equal(metrics[redis.Utilities.getLabelStatusField("v2", redis.DEPLOYMENT_SUCCEEDED)], 1);
                assert.equal(metrics[redis.Utilities.getLabelStatusField("v3", redis.DEPLOYMENT_FAILED)], 1);
                done();
              });
            } else {
              done();
            }
          })
          .catch((err: any) => {
            done(err);
          });
      });

      it("returns 200 and increments the correct counters in Redis when switching deployment keys if SDK version is >=1.5.2-beta", (done) => {
        function sendReport(statusReport: string): Promise<void> {
          return Promise<void>((resolve, reject) => {
            request(server || serverUrl)
              .post("/reportStatus/deploy")
              .set("Content-Type", "application/json")
              .set(SDK_VERSION_HEADER, "1.5.2-beta")
              .send(statusReport)
              .expect(200)
              .end((err: any, result: any): void => {
                if (err) {
                  reject(err);
                }

                resolve(<void>null);
              });
          });
        }

        var anotherDeployment: storage.Deployment = utils.makeStorageDeployment();
        return storageInstance
          .addDeployment(account.id, app.id, anotherDeployment)
          .then((deploymentId: string) => {
            anotherDeployment.id = deploymentId;
          })
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                clientUniqueId: "My iPhone",
                appVersion: "1.0.0",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                status: redis.DEPLOYMENT_SUCCEEDED,
                label: "v2",
                clientUniqueId: "My iPhone",
                appVersion: "1.0.0",
                previousLabelOrAppVersion: "1.0.0",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: anotherDeployment.key,
                status: redis.DEPLOYMENT_SUCCEEDED,
                label: "v1",
                clientUniqueId: "My iPhone",
                appVersion: "1.0.0",
                previousDeploymentKey: deployment.key,
                previousLabelOrAppVersion: "v2",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                clientUniqueId: "My Android",
                appVersion: "1.0.0",
              })
            )
          )
          .then(() =>
            sendReport(
              JSON.stringify({
                deploymentKey: deployment.key,
                status: redis.DEPLOYMENT_FAILED,
                label: "v3",
                clientUniqueId: "My Android",
                appVersion: "1.0.0",
                previousLabelOrAppVersion: "1.0.0",
              })
            )
          )
          .then(() => {
            if (redisManager.isEnabled) {
              return redisManager
                .getMetricsWithDeploymentKey(deployment.key)
                .then((metrics: any) => {
                  assert.equal(metrics[redis.Utilities.getLabelActiveCountField("1.0.0")], 1);
                  assert.equal(metrics[redis.Utilities.getLabelActiveCountField("v2")], 0);
                  assert.equal(metrics[redis.Utilities.getLabelStatusField("v2", redis.DEPLOYMENT_SUCCEEDED)], 1);
                  assert.equal(metrics[redis.Utilities.getLabelStatusField("v3", redis.DEPLOYMENT_FAILED)], 1);
                  return redisManager.getMetricsWithDeploymentKey(anotherDeployment.key);
                })
                .then((metrics: any) => {
                  assert.equal(metrics[redis.Utilities.getLabelActiveCountField("v1")], 1);
                  assert.equal(metrics[redis.Utilities.getLabelStatusField("v1", redis.DEPLOYMENT_SUCCEEDED)], 1);
                  done();
                });
            } else {
              done();
            }
          })
          .catch((err: any) => {
            done(err);
          });
      });
    });

    describe("POST /reportStatus/download", () => {
      it("returns 400 if invalid json is sent", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/download")
          .set("Content-Type", "application/json")
          .send("{invalid: json")
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if deploymentKey is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/download")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              label: "v2",
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 400 if label is unspecified", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/download")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
            })
          )
          .expect(400)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            done();
          });
      });

      it("returns 200 and increments the correct counter in Redis", (done) => {
        request(server || serverUrl)
          .post("/reportStatus/download")
          .set("Content-Type", "application/json")
          .send(
            JSON.stringify({
              deploymentKey: deployment.key,
              label: "v2",
            })
          )
          .expect(200)
          .end((err: any, result: any): void => {
            if (err) {
              throw err;
            }

            if (redisManager.isEnabled) {
              redisManager
                .getMetricsWithDeploymentKey(deployment.key)
                .then((metrics: any) => {
                  assert.equal(metrics[redis.Utilities.getLabelStatusField("v2", redis.DOWNLOADED)], 1);
                  done();
                })
                .catch((err: any) => {
                  done(err);
                });
            } else {
              done();
            }
          });
      });
    });
  });
});
