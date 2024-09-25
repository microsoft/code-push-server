// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as fs from "fs";
import * as path from "path";
import * as q from "q";
import * as request from "supertest";
import superagent = require("superagent");

import * as defaultServer from "../script/default-server";
import * as redis from "../script/redis-manager";
import * as restTypes from "../script/types/rest-definitions";
import * as storage from "../script/storage/storage";
import * as testUtils from "./utils";

import { AzureStorage } from "../script/storage/azure-storage";
import { JsonStorage } from "../script/storage/json-storage";

import Permissions = storage.Permissions;

if (!process.env.AZURE_MANAGEMENT_URL) {
  // cannot use local JSON storage when running tests against an Azure server
  describe("Management Rest API with JSON Storage", () => managementTests(/*useJsonStorage=*/ true));
}

if (process.env.TEST_AZURE_STORAGE) {
  describe("Management Rest API with Azure Storage", () => managementTests());
}

const ACCESS_KEY_MASKING_STRING = "(hidden)";

function managementTests(useJsonStorage?: boolean): void {
  var server: express.Express;
  var serverUrl: string;
  var storage: storage.Storage;
  var redisManager: redis.RedisManager;
  var account: storage.Account;
  var otherAccount: storage.Account;
  var app: storage.App;
  var deployment: storage.Deployment;
  var appPackage: storage.Package;
  var accessKey: storage.AccessKey;
  var packageDescription: string = "Test package for 1.0.0";
  var packageHash: string = "99fb948da846f4ae552b6bd73ac1e12e4ae3a889159d607997a4aef4f197e7bb"; // resources/blob.zip
  var isTestingMetrics: boolean = !!(process.env.REDIS_HOST && process.env.REDIS_PORT);

  before((): q.Promise<void> => {
    account = testUtils.makeAccount();
    otherAccount = testUtils.makeAccount();

    return q<void>(null)
      .then(() => {
        if (process.env.AZURE_MANAGEMENT_URL) {
          serverUrl = process.env.AZURE_MANAGEMENT_URL;
          storage = useJsonStorage ? new JsonStorage() : new AzureStorage();
        } else {
          // use the middleware defined in DefaultServer
          var deferred: q.Deferred<void> = q.defer<void>();

          defaultServer.start(function (err: Error, app: express.Express, serverStorage: storage.Storage) {
            if (err) deferred.reject(err);

            server = app;
            storage = serverStorage;
            deferred.resolve(<void>null);
          }, useJsonStorage);

          return deferred.promise;
        }
      })
      .then(() => {
        return storage.addAccount(account);
      })
      .then((accountId: string) => {
        account.id = accountId;
        return storage.addAccount(otherAccount);
      })
      .then((accountId: string) => {
        otherAccount.id = accountId;
        accessKey = testUtils.makeStorageAccessKey();
        return storage.addAccessKey(account.id, accessKey);
      })
      .then((accessKeyId: string): void => {
        // delete any remaining temp files in the resources folder, which are created by some tests
        var resourcesDirectory: string = path.join(__dirname, "resources");
        var files: string[] = fs.readdirSync(resourcesDirectory);
        files.forEach((file: string) => {
          if (file.match(/^temp_.*/)) {
            try {
              fs.unlinkSync(getTestResource(file));
            } catch (err) {}
          }
        });

        accessKey.id = accessKeyId;

        redisManager = new redis.RedisManager();
      });
  });

  after((): q.Promise<void> => {
    return redisManager.close().then(() => {
      if (storage instanceof JsonStorage) {
        return storage.dropAll();
      }
    });
  });

  describe("GET authenticated", () => {
    it("returns 200 if logged in", (done) => {
      GET("/authenticated", () => done(), 200);
    });

    it("returns unauthorized if invalidly formatted key", (done) => {
      GET("/authenticated", () => done(), 401, "$%");
    });

    it("returns unauthorized if key does not exist", (done) => {
      GET("/authenticated", () => done(), 401, "thisaccesskeydoesnotexist");
    });
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

  describe("GET access keys", (): void => {
    it("returns access keys for existing account, hides actual key strings, and sets accessKey descriptions for backwards compatibility", (done): void => {
      GET("/accessKeys", (response: { accessKeys: restTypes.AccessKey[] }): void => {
        assert(response.accessKeys.length > 0);
        response.accessKeys.forEach((accessKey: restTypes.AccessKey) => {
          assert(accessKey.friendlyName);
          assert.equal(accessKey.name, ACCESS_KEY_MASKING_STRING);
          assert.equal(accessKey.friendlyName, accessKey.description);
        });
        done();
      });
    });
  });

  describe("POST access key", (): void => {
    it("creates new access key for existing account with default expiry", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();
      // Rely on the server to generate a name
      delete accessKeyRequest.name;
      POST("/accessKeys", accessKeyRequest, (location: string, response: { accessKey: restTypes.AccessKey }): void => {
        assert(!!response.accessKey.name);
        assert.notEqual(response.accessKey.name, accessKey.name);
        assert(response.accessKey.expires > 0);
        assert.equal(response.accessKey.friendlyName, accessKeyRequest.friendlyName);
        assert.equal(response.accessKey.description, accessKeyRequest.friendlyName);
        GET(location, () => {
          done();
        });
      });
    });

    describe("Access keys can expire", (): void => {
      var oldAccessKey: storage.AccessKey;
      before(() => {
        oldAccessKey = accessKey;
      });

      it("creates new access key which expires in the specified expiry for existing account", (done): void => {
        var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();
        var oldAccessKey: storage.AccessKey = accessKey;
        var delay = 1000; // 1 second
        accessKeyRequest.ttl = delay;

        POST("/accessKeys", accessKeyRequest, (location: string): void => {
          setTimeout(() => {
            // Use the new, expired key to make an API call
            accessKey = <storage.AccessKey>(<any>accessKeyRequest);
            GET(location, done, 401);
          }, delay + 1000);
        });
      });

      after(() => {
        accessKey = oldAccessKey;
      });
    });

    it("returns 400 if invalid ttl field provided", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.ttl = <any>"notanumber";

      POST("/accessKeys", accessKeyRequest, done, null, 400);
    });

    it("returns 400 if ttl field is 0", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.ttl = 0;

      POST("/accessKeys", accessKeyRequest, done, null, 400);
    });

    it("returns 400 if ttl field is less than 0", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.ttl = -5;

      POST("/accessKeys", accessKeyRequest, done, null, 400);
    });

    it("returns 400 if empty friendlyName provided", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.friendlyName = "";

      POST("/accessKeys", accessKeyRequest, done, null, 400);
    });

    it("returns 400 if friendlyName only contains spaces", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.friendlyName = " \t";

      POST("/accessKeys", accessKeyRequest, done, null, 400);
    });

    it("returns 409 if duplicate name provided", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.name = accessKey.name;

      POST("/accessKeys", accessKeyRequest, done, null, 409);
    });

    it("returns 409 if duplicate friendlyName provided", (done): void => {
      var accessKeyRequest: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      accessKeyRequest.friendlyName = accessKey.friendlyName;

      POST("/accessKeys", accessKeyRequest, done, null, 409);
    });
  });

  describe("GET access key", (): void => {
    it("successfully gets an existing access key by name", (done): void => {
      GET("/accessKeys/" + accessKey.name, (response: { accessKey: restTypes.AccessKey }): void => {
        assert.equal(response.accessKey.friendlyName, accessKey.friendlyName);
        assert(response.accessKey.expires);
        done();
      });
    });

    it("successfully gets an existing access key by friendlyName", (done): void => {
      GET("/accessKeys/" + accessKey.friendlyName, (response: { accessKey: restTypes.AccessKey }): void => {
        assert.equal(response.accessKey.friendlyName, accessKey.friendlyName);
        assert(response.accessKey.expires);
        done();
      });
    });

    it("returns 404 for a missing access key", (done): void => {
      var url = "/accessKeys/fake_access_key_name";

      GET(url, done, 404);
    });
  });

  describe("PATCH access key", (): void => {
    var oldAccessKey: storage.AccessKey;

    beforeEach(() => {
      oldAccessKey = accessKey;
      accessKey = testUtils.makeStorageAccessKey();
      return storage.addAccessKey(account.id, accessKey);
    });

    it("successfully updates an access key", (done) => {
      var newTtl = 1000 * 60 * 60 * 24 * 5; // 5 days
      var newAccessKey = <restTypes.AccessKeyRequest>{
        friendlyName: "new name",
        ttl: newTtl,
      };

      var oldUrl: string = "/accessKeys/" + accessKey.friendlyName;
      var newUrl: string = "/accessKeys/" + newAccessKey.friendlyName;
      PATCH(oldUrl, newAccessKey, () => {
        GET(newUrl, (response: any) => {
          assert.equal(response.accessKey.friendlyName, newAccessKey.friendlyName);
          assert.equal(response.accessKey.description, newAccessKey.friendlyName);
          assert(response.accessKey.expires <= new Date().getTime() + newTtl + 1000 * 60); // One minute buffer to account for clocks being out of sync
          assert(response.accessKey.expires > new Date().getTime() + newTtl - 1000 * 60 * 60 * 1); // Should expire sometime within this time buffer of one hour
          GET(oldUrl, done, 404);
        });
      });
    });

    it("successfully expires an access key", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{
        ttl: 0, // expires immediately
      };

      var url: string = "/accessKeys/" + accessKey.friendlyName;
      PATCH(url, newAccessKey, () => {
        setTimeout(() => {
          GET(url, done, 401);
        }, 1000);
      });
    });

    it("cannot create a new access key", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{ friendlyName: "newAccessKey" };
      var url = `/accessKeys/${newAccessKey.friendlyName}`;
      PATCH(url, newAccessKey, done, 404);
    });

    it("ignores and does not update name field", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{
        friendlyName: "new friendly name",
        name: "newkey",
      };

      var oldUrl: string = "/accessKeys/" + accessKey.friendlyName;
      var newUrl: string = "/accessKeys/" + newAccessKey.friendlyName;
      var newKeyUrl: string = "/accessKeys/" + newAccessKey.name;
      PATCH(oldUrl, newAccessKey, () => {
        GET(newUrl, (response: any) => {
          assert.equal(response.accessKey.friendlyName, newAccessKey.friendlyName);
          assert.equal(response.accessKey.description, newAccessKey.friendlyName);
          GET(newKeyUrl, done, 404);
        });
      });
    });

    it("does not change undefined fields", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{};
      PATCH("/accessKeys/" + accessKey.friendlyName, newAccessKey, () => {
        GET("/accessKeys/" + accessKey.friendlyName, (response: any) => {
          assert.equal(response.accessKey.friendlyName, accessKey.friendlyName);
          assert.equal(response.accessKey.description, accessKey.description);
          assert.equal(response.accessKey.expires, accessKey.expires);
          done();
        });
      });
    });

    it("does not change null fields", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{ friendlyName: null };
      PATCH("/accessKeys/" + accessKey.friendlyName, newAccessKey, () => {
        GET("/accessKeys/" + accessKey.friendlyName, (response: any) => {
          assert.equal(response.accessKey.friendlyName, accessKey.friendlyName);
          assert.equal(response.accessKey.description, accessKey.description);
          assert.equal(response.accessKey.expires, accessKey.expires);
          done();
        });
      });
    });

    it("returns 400 for empty friendlyName field", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{ friendlyName: "" };
      PATCH(
        "/accessKeys/" + accessKey.friendlyName,
        newAccessKey,
        () => {
          done();
        },
        400
      );
    });

    it("returns 400 for friendlyName field with only whitespaces", (done) => {
      var newAccessKey = <restTypes.AccessKeyRequest>{ friendlyName: " \t" };
      PATCH(
        "/accessKeys/" + accessKey.friendlyName,
        newAccessKey,
        () => {
          done();
        },
        400
      );
    });

    it("returns 400 for invalid ttl field", (done) => {
      var newAccessKey = { ttl: "notanumber" };
      PATCH(
        "/accessKeys/" + accessKey.friendlyName,
        newAccessKey,
        () => {
          done();
        },
        400
      );
    });

    it("returns 400 for ttl field < 0", (done) => {
      var newAccessKey = { ttl: -50 };
      PATCH(
        "/accessKeys/" + accessKey.friendlyName,
        newAccessKey,
        () => {
          done();
        },
        400
      );
    });

    it("returns 409 if duplicate friendlyName provided", (done): void => {
      var newAccessKey = { friendlyName: oldAccessKey.friendlyName };
      PATCH(
        "/accessKeys/" + accessKey.friendlyName,
        newAccessKey,
        () => {
          done();
        },
        409
      );
    });
  });

  describe("DELETE access key", (): void => {
    it("successfully deletes an existing access key by name", (done): void => {
      var accessKeyToDelete: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      POST("/accessKeys", accessKeyToDelete, (keyLocation: string): void => {
        GET(keyLocation, (key: { accessKey: restTypes.AccessKey }): void => {
          assert(!!key && !!key.accessKey);
          DELETE(`/accessKeys/${accessKeyToDelete.name}`, (): void => {
            GET(keyLocation, done, 404);
          });
        });
      });
    });

    it("successfully deletes an existing access key by friendlyName", (done): void => {
      var accessKeyToDelete: restTypes.AccessKeyRequest = testUtils.makeAccessKeyRequest();

      POST("/accessKeys", accessKeyToDelete, (keyLocation: string): void => {
        GET(keyLocation, (key: { accessKey: restTypes.AccessKey }): void => {
          assert(!!key && !!key.accessKey);
          DELETE(`/accessKeys/${key.accessKey.friendlyName}`, (): void => {
            GET(keyLocation, done, 404);
          });
        });
      });
    });

    it("returns 404 for a missing access key", (done): void => {
      var url = "/accessKeys/fake_access_key_name";

      DELETE(url, done, 404);
    });
  });

  describe("DELETE sessions", (): void => {
    it("successfully deletes all session keys created by the specified machine name", (done): void => {
      var machineName = "test delete session";
      var firstKeyName: string;
      var secondKeyName: string;
      var thirdKeyName: string;
      var newAccessKey = testUtils.makeStorageAccessKey();
      newAccessKey.createdBy = machineName;
      newAccessKey.isSession = true;
      firstKeyName = newAccessKey.friendlyName;
      storage
        .addAccessKey(account.id, newAccessKey)
        .then(() => {
          newAccessKey = testUtils.makeStorageAccessKey();
          newAccessKey.createdBy = machineName;
          newAccessKey.isSession = true;
          secondKeyName = newAccessKey.friendlyName;
          return storage.addAccessKey(account.id, newAccessKey);
        })
        .then(() => {
          newAccessKey = testUtils.makeStorageAccessKey();
          newAccessKey.createdBy = machineName;
          newAccessKey.isSession = false;
          thirdKeyName = newAccessKey.friendlyName;
          return storage.addAccessKey(account.id, newAccessKey);
        })
        .then(() => {
          DELETE(`/sessions/${machineName}`, () => {
            GET(
              `/accessKeys/${firstKeyName}`,
              () => {
                GET(
                  `/accessKeys/${secondKeyName}`,
                  () => {
                    GET(`/accessKeys/${thirdKeyName}`, () => {
                      done();
                    });
                  },
                  404
                );
              },
              404
            );
          });
        })
        .catch(done)
        .done();
    });

    it("returns 404 for a machine name that does not have any sessions associated with it", (done): void => {
      var url = "/sessions/fake_machine_name";

      DELETE(url, done, 404);
    });
  });

  describe("Apps and deployment tests", () => {
    var packageHistory: storage.Package[];
    beforeEach(function () {
      app = testUtils.makeStorageApp();
      packageHistory = [];
      return storage
        .addApp(account.id, app)
        .then((addedApp: storage.App) => {
          app.id = addedApp.id;
          deployment = testUtils.makeStorageDeployment();
          return storage.addDeployment(account.id, app.id, deployment);
        })
        .then((deploymentId: string) => {
          deployment.id = deploymentId;
          appPackage = testUtils.makePackage();
          appPackage.blobUrl = "/resources/blob.zip";
          appPackage.description = packageDescription;
          appPackage.isMandatory = true;
          appPackage.label = "v1";
          appPackage.manifestBlobUrl = null;
          appPackage.packageHash = packageHash;
          appPackage.appVersion = "1.0.0";
          packageHistory.push(appPackage);
          deployment.package = appPackage;
          return storage.commitPackage(account.id, app.id, deployment.id, deployment.package);
        })
        .then(() => {
          return redisManager.incrementLabelStatusCount(deployment.key, "v1", redis.DEPLOYMENT_SUCCEEDED);
        });
    });

    describe("GET apps", () => {
      it("returns apps for existing account", (done) => {
        GET("/apps", (response: any) => {
          assert(response.apps.length > 0);
          done();
        });
      });

      it("returns 404 for incorrect account", (done) => {
        var url = "/accounts/fake_account_id/apps";
        GET(url, done, 404);
      });

      it("resolves apps by qualified name", (done) => {
        var duplicateApp: restTypes.App = testUtils.makeRestApp();
        POST("/apps", duplicateApp, (response: any) => {
          POST(`/apps/${duplicateApp.name}/transfer/${otherAccount.email}`, /*objToSend*/ {}, (response: any) => {
            POST("/apps", duplicateApp, (response: any) => {
              GET(`/apps/${duplicateApp.name}`, (response: any) => {
                assert.equal(response.app.name, duplicateApp.name);
                assert.equal(response.app.collaborators[account.email].permission, Permissions.Owner);
                GET(`/apps/${otherAccount.email}:${duplicateApp.name}`, (response: any) => {
                  assert.equal(response.app.name, `${otherAccount.email}:${duplicateApp.name}`);
                  assert.equal(response.app.collaborators[account.email].permission, Permissions.Collaborator);
                  done();
                });
              });
            });
          });
        });
      });
    });

    describe("POST apps", () => {
      it("creates app for existing account", function (done) {
        var newApp: restTypes.App = testUtils.makeRestApp();
        POST("/apps", newApp, (location: string) => {
          GET(location, (response: any) => {
            assert.equal(response.app.name, newApp.name);
            done();
          });
        });
      });

      it("creates default deployments and default deployment keys", function (done) {
        var newApp: restTypes.App = testUtils.makeRestApp();

        var url = "/apps";

        POST(url, newApp, (location: string, responseBody: any): void => {
          assert(responseBody);
          var app: restTypes.App = responseBody.app;
          assert(app);
          assert.equal(app.deployments.length, 2);

          for (var i = 0; i < app.deployments.length; ++i) {
            var deploymentName: string = app.deployments[i];
            assert(deploymentName === "Production" || deploymentName === "Staging", "deploymentName = " + deploymentName);
          }

          done();
        });
      });

      it("can override default deployment creation", function (done) {
        var newApp: restTypes.AppCreationRequest = testUtils.makeRestApp();

        newApp.manuallyProvisionDeployments = true;

        var url = "/apps";

        POST(url, newApp, (location: string): void => {
          url += "/" + newApp.name + "/deployments";
          GET(url, (response: { deployments: restTypes.Deployment[] }): void => {
            assert.equal(response.deployments.length, 0);
            done();
          });
        });
      });

      it("requires a name to create an app", (done) => {
        var url = "/apps";
        var newApp = {};
        POST(url, newApp, done, null, 400);
      });

      it("returns 409 if duplicate name provided", (done): void => {
        var newApp: restTypes.App = testUtils.makeRestApp();

        newApp.name = app.name;

        POST("/apps", newApp, done, null, 409);
      });

      it("tracks creation time", (done) => {
        var newApp: restTypes.App = testUtils.makeRestApp();
        var url = "/apps";

        POST(url, newApp, (location: string): void => {
          storage
            .getApps(account.id)
            .then((apps: storage.App[]) => {
              for (var app of apps) {
                if (app.name === newApp.name) {
                  assert(app.createdTime);

                  return;
                }
              }

              throw new Error("Failed to find newly created app.");
            })
            .done(done, done);
        });
      });
    });

    describe("GET app", () => {
      it("successfully gets an existing app", (done) => {
        GET("/apps/" + app.name, (response: any) => {
          assert.equal(response.app.name, app.name);
          done();
        });
      });

      it("returns 404 for a missing app", (done) => {
        var url = "/apps/fake_app_name";
        GET(url, done, 404);
      });
    });

    describe("DELETE app", () => {
      it("successfully deletes an existing app", (done) => {
        var url: string = "/apps/" + app.name;
        DELETE(url, () => {
          GET(url, done, 404);
        });
      });

      it("returns 404 for a missing app", (done) => {
        var url = "/apps/" + "fake_app_name";
        DELETE(url, done, 404);
      });
    });

    describe("PATCH app", () => {
      it("successfully updates an existing app", (done) => {
        var newApp: restTypes.App = testUtils.makeRestApp();
        var oldUrl: string = "/apps/" + app.name;
        var newUrl: string = "/apps/" + newApp.name;

        PATCH(oldUrl, newApp, () => {
          GET(newUrl, (response: any) => {
            assert.equal(response.app.name, newApp.name);
            GET(oldUrl, done, 404);
          });
        });
      });

      it("cannot create a new app", (done) => {
        var newApp: restTypes.App = testUtils.makeRestApp();
        var url = "/apps/desiredAppName";

        PATCH(url, newApp, done, 404);
      });

      it("does not change undefined fields", (done) => {
        var newApp = <restTypes.App>{};
        PATCH("/apps/" + app.name, newApp, () => {
          GET("/apps/" + app.name, (response: any) => {
            assert.equal(response.app.name, app.name);
            done();
          });
        });
      });

      it("does not change null fields", (done) => {
        var newApp: restTypes.App = testUtils.makeRestApp();

        newApp.name = null;

        PATCH("/apps/" + app.name, newApp, () => {
          GET("/apps/" + app.name, (response: any) => {
            assert.equal(response.app.name, app.name);
            done();
          });
        });
      });

      it("does attempt to change empty string fields", (done) => {
        var newApp: restTypes.App = testUtils.makeRestApp();

        newApp.name = "";

        PATCH("/apps/" + app.name, newApp, done, 400);
      });

      it("returns 409 if duplicate name provided", (done): void => {
        var newApp: restTypes.App = testUtils.makeRestApp();

        POST("/apps", newApp, (location: string): void => {
          var oldName = newApp.name;
          newApp.name = app.name;
          PATCH("/apps/" + oldName, newApp, done, 409);
        });
      });
    });

    describe("GET deployments", () => {
      it("returns deployments for existing app", (done) => {
        var url: string = "/apps/" + app.name + "/deployments";
        GET(url, (response: any) => {
          assert.equal(response.deployments.length, 1);
          assert.equal(response.deployments[0].key, deployment.key);
          done();
        });
      });

      it("returns 404 for missing app", (done) => {
        var url = "/apps/fake_app_name/deployments";
        GET(url, done, 404);
      });
    });

    describe("POST deployment", () => {
      it("creates new deployment with default deployment key", function (done) {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();

        var url: string = "/apps/" + app.name + "/deployments";

        POST(url, newDeployment, (location: string): void => {
          GET(location, (response: { deployment: restTypes.Deployment }): void => {
            assert(!!response.deployment.key);
            done();
          });
        });
      });

      it("creates new deployment with custom deployment key", function (done) {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();

        newDeployment.key = testUtils.generateKey();

        var url: string = "/apps/" + app.name + "/deployments";

        POST(url, newDeployment, (location: string): void => {
          GET(location, (response: { deployment: restTypes.Deployment }): void => {
            assert.equal(response.deployment.key, newDeployment.key);
            done();
          });
        });
      });

      it("returns 404 for a missing app", (done) => {
        var newDeployment = { name: "Some Deployment" };
        var url = "/apps/" + "fake_app_name" + "/deployments";

        POST(url, newDeployment, done, null, 404);
      });

      it("requires a name for a deployment", (done) => {
        var newDeployment = {};
        var url = "/apps/" + app.name + "/deployments";

        POST(url, newDeployment, done, null, 400);
      });

      it("returns 409 if duplicate name provided", (done): void => {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();
        newDeployment.name = deployment.name;
        var url: string = "/apps/" + app.name + "/deployments";

        POST(url, newDeployment, done, null, 409);
      });

      it("tracks creation time", (done) => {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();
        var url: string = "/apps/" + app.name + "/deployments";

        POST(url, newDeployment, (location: string): void => {
          storage
            .getDeployments(account.id, app.id)
            .then((deployments: storage.Deployment[]) => {
              for (var deployment of deployments) {
                if (deployment.name === newDeployment.name) {
                  assert(deployment.createdTime);

                  return;
                }
              }

              throw new Error("Failed to find newly created deployment.");
            })
            .done(done, done);
        });
      });
    });

    describe("GET deployment", () => {
      it("successfully gets a deployment for an existing app", (done) => {
        GET("/apps/" + app.name + "/deployments/" + deployment.name, (response: any) => {
          assert.equal(response.deployment.name, deployment.name);
          assert.equal(response.deployment.key, deployment.key);
          done();
        });
      });

      it("returns 404 for a missing deployment", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/fake_deployment_name";
        GET(url, done, 404);
      });
    });

    describe("DELETE deployment", () => {
      it("successfully deletes a deployment for an existing app", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name;
        DELETE(url, () => {
          GET(url, done, 404);
        });
      });

      it("returns 404 for a missing app", (done) => {
        var url: string = "/apps/fake_app_name/deployments/" + deployment.name;
        DELETE(url, done, 404);
      });
    });

    describe("PATCH deployment", () => {
      it("updates existing deployment", (done) => {
        var updatedDeployment: restTypes.Deployment = testUtils.makeRestDeployment();
        var oldUrl: string = "/apps/" + app.name + "/deployments/" + deployment.name;
        var updatedUrl: string = "/apps/" + app.name + "/deployments/" + updatedDeployment.name;

        PATCH(oldUrl, updatedDeployment, () => {
          GET(updatedUrl, (response: any) => {
            assert.equal(response.deployment.name, updatedDeployment.name);
            assert.equal(response.deployment.key, deployment.key);
            done();
          });
        });
      });

      it("cannot create a new deployment", (done) => {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();
        var url: string = "/apps/" + app.name + "/deployments/desiredName";

        PATCH(url, newDeployment, done, 404);
      });

      it("returns 409 if duplicate name provided", (done): void => {
        var newDeployment: restTypes.Deployment = testUtils.makeRestDeployment();
        var url: string = "/apps/" + app.name + "/deployments";

        newDeployment.name = "newDeployment";

        POST(url, newDeployment, (location: string): void => {
          GET(location, (response: { deployment: any }): void => {
            response.deployment.name = deployment.name;

            assert.notEqual(response.deployment.key, deployment.key);

            PATCH(location, response.deployment, done, 409);
          });
        });
      });
    });

    describe("GET packageInfo", () => {
      it("gets info for a deployment", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name;
        GET(url, (response: any) => {
          assert.equal(response.deployment.package.description, packageDescription);
          assert.equal(response.deployment.package.packageHash, packageHash);
          assert.equal(response.deployment.package.label, "v1");
          done();
        });
      });

      it("gets package history for empty deployment", (done) => {
        deployment = testUtils.makeStorageDeployment();
        storage.addDeployment(account.id, app.id, deployment).then((deploymentId: string) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/history";
          GET(url, (response: any) => {
            assert.equal(response.history.length, 0);
            done();
          });
        });
      });

      it("gets package history for deployment with history", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/history";
        GET(url, (response: any) => {
          assert.equal(response.history.length, 1);
          assert.equal(response.history[0].description, packageDescription);
          done();
        });
      });

      if (isTestingMetrics) {
        it("gets metrics for deployment", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/metrics";

          GET(url, (response: any) => {
            assert.equal(response.metrics.v1.installed, 1);
            done();
          });
        });
      }
    });

    describe("DELETE history", () => {
      var otherApp: storage.App;
      var otherDeployment: storage.Deployment;
      before(function () {
        otherApp = testUtils.makeStorageApp();
        otherDeployment = testUtils.makeStorageDeployment();
        return storage
          .addApp(otherAccount.id, otherApp)
          .then((addedApp: storage.App) => {
            otherApp.id = addedApp.id;
            return storage.addDeployment(otherAccount.id, otherApp.id, otherDeployment);
          })
          .then((deploymentId: string) => {
            otherDeployment.id = deploymentId;
            var otherAppPackage: storage.Package = testUtils.makePackage();
            otherAppPackage.blobUrl = "/resources/blob.zip";
            otherAppPackage.description = packageDescription;
            otherAppPackage.isMandatory = true;
            otherAppPackage.manifestBlobUrl = null;
            otherAppPackage.packageHash = "hash100";
            otherAppPackage.appVersion = "1.0.0";
            otherDeployment.package = otherAppPackage;
            return storage.commitPackage(otherAccount.id, otherApp.id, otherDeployment.id, otherDeployment.package);
          })
          .then(() => {
            return storage.addCollaborator(otherAccount.id, otherApp.id, account.email);
          });
      });

      it("successfully clears the package history and relevant metrics for an existing deployment", (done) => {
        var url: string = `/apps/${app.name}/deployments/${deployment.name}/history`;
        DELETE(url, () => {
          GET(url, (response: any) => {
            assert.equal(response.history.length, 0);
            // Test that metrics has been cleared too.
            if (isTestingMetrics) {
              var url: string = `/apps/${app.name}/deployments/${deployment.name}/metrics`;

              GET(url, (response: any) => {
                assert.equal(JSON.stringify(response.metrics), "{}");
                done();
              });
            } else {
              done();
            }
          });
        });
      });

      it("returns 403 if app with deployment history being cleared is not owned by user", (done) => {
        var url: string = `/apps/${otherApp.name}/deployments/${otherDeployment.name}/history`;
        DELETE(url, done, 403);
      });
    });

    describe("POST release", () => {
      var identicalPackage: string = getTestResource("blob.zip");
      var differentPackage: string = getTestResource("test.zip");

      it("returns 400 if appVersion is not specified", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage();
        POST(url, { packageInfo: releasePackage }, done, differentPackage, 400);
      });

      it("returns 409 if the latest release is identical", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.0.0");
        POST(url, { packageInfo: releasePackage }, done, identicalPackage, 409);
      });

      it("returns 409 if release of identical package for same range", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.*");
        POST(
          url,
          { packageInfo: releasePackage },
          () => {
            var releasePackage: storage.Package = testUtils.makePackage("1.*");
            POST(url, { packageInfo: releasePackage }, done, identicalPackage, 409);
          },
          identicalPackage
        );
      });

      it("returns 409 if release of identical package for similar range", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.*");
        POST(
          url,
          { packageInfo: releasePackage },
          () => {
            var releasePackage: storage.Package = testUtils.makePackage("1.x");
            POST(url, { packageInfo: releasePackage }, done, identicalPackage, 409);
          },
          identicalPackage
        );
      });

      it("returns 409 if release of identical package of same app version in release history", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
        POST(
          url,
          { packageInfo: releasePackage },
          () => {
            var releasePackage: storage.Package = testUtils.makePackage("2.0.0");
            POST(
              url,
              { packageInfo: releasePackage },
              () => {
                var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
                POST(url, { packageInfo: releasePackage }, done, identicalPackage, 409);
              },
              differentPackage
            );
          },
          identicalPackage
        );
      });

      it("returns 409 if release of identical package for app version in old version's range in history", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.*");
        POST(
          url,
          { packageInfo: releasePackage },
          () => {
            var releasePackage: storage.Package = testUtils.makePackage("2.*");
            POST(
              url,
              { packageInfo: releasePackage },
              () => {
                var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
                POST(url, { packageInfo: releasePackage }, done, identicalPackage, 409);
              },
              differentPackage
            );
          },
          identicalPackage
        );
      });

      if (!useJsonStorage) {
        it("returns 201 if release of different package for same range", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
          var releasePackage: storage.Package = testUtils.makePackage("1.*");
          POST(
            url,
            { packageInfo: releasePackage },
            () => {
              var releasePackage: storage.Package = testUtils.makePackage("2.*");
              POST(
                url,
                { packageInfo: releasePackage },
                () => {
                  done();
                },
                differentPackage
              );
            },
            identicalPackage
          );
        });

        it("returns 201 if release of identical package for different range", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
          var releasePackage: storage.Package = testUtils.makePackage("1.*");
          POST(
            url,
            { packageInfo: releasePackage },
            () => {
              var releasePackage: storage.Package = testUtils.makePackage("2.*");
              POST(
                url,
                { packageInfo: releasePackage },
                () => {
                  done();
                },
                identicalPackage
              );
            },
            identicalPackage
          );
        });

        it("returns 201 if release of identical package for app version range matching an previous release's app version", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
          var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
          POST(
            url,
            { packageInfo: releasePackage },
            () => {
              var releasePackage: storage.Package = testUtils.makePackage("1.*");
              POST(
                url,
                { packageInfo: releasePackage },
                () => {
                  done();
                },
                identicalPackage
              );
            },
            identicalPackage
          );
        });

        it("returns 201 if release of different package for app version in old version's range", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
          var releasePackage: storage.Package = testUtils.makePackage("1.*");
          POST(
            url,
            { packageInfo: releasePackage },
            () => {
              var releasePackage: storage.Package = testUtils.makePackage("2.*");
              POST(
                url,
                { packageInfo: releasePackage },
                () => {
                  var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
                  POST(
                    url,
                    { packageInfo: releasePackage },
                    () => {
                      done();
                    },
                    differentPackage
                  );
                },
                differentPackage
              );
            },
            identicalPackage
          );
        });

        it("returns 201 if release of different package of same app version in release history", (done) => {
          var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
          var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
          POST(
            url,
            { packageInfo: releasePackage },
            () => {
              var releasePackage: storage.Package = testUtils.makePackage("2.0.0");
              POST(
                url,
                { packageInfo: releasePackage },
                () => {
                  var releasePackage: storage.Package = testUtils.makePackage("1.2.0");
                  POST(
                    url,
                    { packageInfo: releasePackage },
                    () => {
                      done();
                    },
                    differentPackage
                  );
                },
                differentPackage
              );
            },
            identicalPackage
          );
        });
      }

      it("returns 409 if the latest release contains a rollout", (done) => {
        var secondAppPackage: storage.Package = testUtils.makePackage();
        secondAppPackage.appVersion = "1.0.0";
        secondAppPackage.blobUrl = "/resources/blob.zip";
        secondAppPackage.description = "disabled package";
        secondAppPackage.isMandatory = true;
        secondAppPackage.label = "v2";
        secondAppPackage.manifestBlobUrl = null;
        secondAppPackage.packageHash = "hash101";
        secondAppPackage.rollout = 25;

        storage
          .commitPackage(account.id, app.id, deployment.id, secondAppPackage)
          .then(() => {
            var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
            var releasePackage: storage.Package = testUtils.makePackage();
            releasePackage.appVersion = "1.0.1";
            POST(url, { packageInfo: releasePackage }, done, differentPackage, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 201 and nullifies rollout for disabled releases", (done) => {
        var secondAppPackage: storage.Package = testUtils.makePackage();
        secondAppPackage.appVersion = "1.0.0";
        secondAppPackage.blobUrl = "/resources/blob.zip";
        secondAppPackage.description = "disabled package";
        secondAppPackage.isMandatory = true;
        secondAppPackage.isDisabled = true;
        secondAppPackage.label = "v2";
        secondAppPackage.manifestBlobUrl = null;
        secondAppPackage.packageHash = "hash101";
        secondAppPackage.rollout = 25;

        storage
          .commitPackage(account.id, app.id, deployment.id, secondAppPackage)
          .then(() => {
            var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
            var releasePackage: storage.Package = testUtils.makePackage();
            releasePackage.appVersion = "1.0.1";
            POST(
              url,
              { packageInfo: releasePackage },
              () => {
                storage
                  .getPackageHistory(account.id, app.id, deployment.id)
                  .then((packageHistory: storage.Package[]) => {
                    assert.strictEqual(packageHistory[1].rollout, null);
                  })
                  .done(done, done);
              },
              differentPackage
            );
          })
          .catch(done)
          .done();
      });

      it("can release disabled update", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage();
        releasePackage.appVersion = "1.0.1";
        releasePackage.isDisabled = true;
        POST(
          url,
          { packageInfo: releasePackage },
          () => {
            storage
              .getPackageHistory(account.id, app.id, deployment.id)
              .then((packageHistory: storage.Package[]) => {
                assert.equal(packageHistory.length, 2);
                assert.equal(packageHistory[1].isDisabled, true);
              })
              .done(done, done);
          },
          differentPackage
        );
      });
    });

    describe("POST promote", () => {
      var otherDeployment: storage.Deployment;
      beforeEach(function () {
        otherDeployment = testUtils.makeStorageDeployment();
        return storage.addDeployment(account.id, app.id, otherDeployment).then((deploymentId: string) => {
          otherDeployment.id = deploymentId;
        });
      });

      it("returns 404 if promoting from an empty deployment", (done) => {
        var url: string = `/apps/${app.name}/deployments/${otherDeployment.name}/promote/${deployment.name}`;
        POST(url, { packageInfo: {} }, done, null, 404);
      });

      it("returns 409 if destination deployment has an unfinished rollout", (done) => {
        var otherPackage: storage.Package;
        otherPackage = testUtils.makePackage();
        otherPackage.blobUrl = "/resources/test.zip";
        otherPackage.description = packageDescription;
        otherPackage.isMandatory = true;
        otherPackage.manifestBlobUrl = null;
        otherPackage.packageHash = "hash100";
        otherPackage.rollout = 25;
        otherPackage.appVersion = "1.0.0";
        otherPackage.label = "v1";
        otherDeployment.package = otherPackage;
        storage
          .commitPackage(account.id, app.id, otherDeployment.id, otherDeployment.package)
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if the promoted package is identical", (done) => {
        var identicalPackage: storage.Package = testUtils.makePackage("1.0.0");
        storage
          .commitPackage(account.id, app.id, deployment.id, identicalPackage)
          .then(() => storage.commitPackage(account.id, app.id, otherDeployment.id, identicalPackage))
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if promotion of identical package for same range", (done) => {
        var identicalPackage: storage.Package = testUtils.makePackage("1.*");
        storage
          .commitPackage(account.id, app.id, deployment.id, identicalPackage)
          .then(() => storage.commitPackage(account.id, app.id, otherDeployment.id, identicalPackage))
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if promotion of identical package for similar range", (done) => {
        var identicalPackage: storage.Package = testUtils.makePackage("1.*");
        storage
          .commitPackage(account.id, app.id, deployment.id, identicalPackage)
          .then(() => {
            identicalPackage.appVersion = "1.x";
            return storage.commitPackage(account.id, app.id, otherDeployment.id, identicalPackage);
          })
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if promotion of identical package of same app version in target deployment's release history", (done) => {
        var identicalPackage: storage.Package = testUtils.makePackage("1.0.0");
        storage
          .commitPackage(account.id, app.id, otherDeployment.id, identicalPackage)
          .then(() => {
            identicalPackage.appVersion = "2.0.0";
            return storage.commitPackage(account.id, app.id, otherDeployment.id, identicalPackage);
          })
          .then(() => {
            identicalPackage.appVersion = "1.0.0";
            return storage.commitPackage(account.id, app.id, deployment.id, identicalPackage);
          })
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if promotion of identical package for app version in old version's range in target deployment's history", (done) => {
        var identicalPackage: storage.Package = testUtils.makePackage("1.*");
        storage
          .commitPackage(account.id, app.id, otherDeployment.id, identicalPackage)
          .then(() => {
            identicalPackage.appVersion = "2.*";
            return storage.commitPackage(account.id, app.id, otherDeployment.id, identicalPackage);
          })
          .then(() => {
            identicalPackage.appVersion = "1.0.3";
            return storage.commitPackage(account.id, app.id, deployment.id, identicalPackage);
          })
          .then(() => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            POST(url, { packageInfo: {} }, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 400 if rollout value is invalid", (done) => {
        var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
        POST(url, { packageInfo: { rollout: -1 } }, done, null, 400);
      });

      it("returns 400 if appVersion is invalid", (done) => {
        var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
        POST(url, { packageInfo: { appVersion: "abcde" } }, done, null, 400);
      });

      it("returns 201 and promotes the latest package from the source deployment", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var releasePackage: storage.Package = testUtils.makePackage("1.0.1");
        POST(
          url,
          { packageInfo: releasePackage },
          (location: string, result: any) => {
            var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${otherDeployment.name}`;
            var newDescription: string = appPackage.description + " changed";
            var newIsMandatory: boolean = !appPackage.isMandatory;
            POST(url, { packageInfo: { description: newDescription, isMandatory: newIsMandatory } }, () => {
              storage
                .getDeployment(account.id, app.id, otherDeployment.id)
                .then((deployment: storage.Deployment) => {
                  assert.equal(deployment.package.packageHash, result.package.packageHash);
                  assert.equal(deployment.package.description, newDescription);
                  assert.equal(deployment.package.isMandatory, newIsMandatory);
                })
                .done(done, done);
            });
          },
          getTestResource("test.zip")
        );
      });

      it("returns 201 and nullifies rollout for new release as well as previous disabled release", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";
        var secondAppPackage: storage.Package = testUtils.makePackage("1.0.0");
        secondAppPackage.appVersion = "1.0.0";
        secondAppPackage.description = "disabled package";
        secondAppPackage.isMandatory = true;
        secondAppPackage.isDisabled = true;
        secondAppPackage.label = "v2";
        secondAppPackage.rollout = 25;
        POST(
          url,
          { packageInfo: secondAppPackage },
          (location: string, result: any) => {
            var url: string = "/apps/" + app.name + "/deployments/" + otherDeployment.name + "/release";
            var otherPackage: storage.Package = testUtils.makePackage("1.0.2");
            otherPackage.description = "new description";
            otherPackage.isMandatory = true;
            otherPackage.rollout = 50;
            otherPackage.appVersion = "1.0.2";
            POST(
              url,
              { packageInfo: otherPackage },
              () => {
                var url: string = `/apps/${app.name}/deployments/${otherDeployment.name}/promote/${deployment.name}`;
                POST(url, { packageInfo: {} }, () => {
                  storage
                    .getPackageHistory(account.id, app.id, deployment.id)
                    .then((newPackageHistory: storage.Package[]) => {
                      var disabledPackage = newPackageHistory[newPackageHistory.length - 2];
                      var promotedPackage = newPackageHistory[newPackageHistory.length - 1];

                      assert.strictEqual(disabledPackage.rollout, null);
                      assert.equal(promotedPackage.description, otherPackage.description);
                      assert.strictEqual(promotedPackage.rollout, null);
                      assert.equal(promotedPackage.packageHash, result.package.packageHash);
                    })
                    .done(done, done);
                });
              },
              getTestResource("test.zip")
            );
          },
          getTestResource("test.zip")
        );
      });

      it("can promote to a deployment with no package", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";

        var packageToPromote: storage.Package = testUtils.makePackage("1.0.0");
        packageToPromote.appVersion = "1.0.0";
        packageToPromote.description = "disabled package";
        packageToPromote.isMandatory = true;
        packageToPromote.isDisabled = false;

        POST(
          url,
          { packageInfo: packageToPromote },
          (location: string, resultBody: any) => {
            var targetDeployment: storage.Deployment = testUtils.makeStorageDeployment();

            storage.addDeployment(account.id, app.id, targetDeployment).then((targetDeploymentId: string) => {
              var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${targetDeployment.name}`;

              POST(url, {}, (location: string, promotedBody: any) => {
                assert.equal(promotedBody.package.packageHash, resultBody.package.packageHash);

                done();
              });
            });
          },
          getTestResource("test.zip")
        );
      });

      it("can promote a disabled release", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";

        var disabledPackage: storage.Package = testUtils.makePackage("1.0.0");
        disabledPackage.appVersion = "1.0.0";
        disabledPackage.description = "disabled package";
        disabledPackage.isMandatory = true;
        disabledPackage.isDisabled = true;

        POST(
          url,
          { packageInfo: disabledPackage },
          (location: string, resultBody: any) => {
            var targetDeployment: storage.Deployment = testUtils.makeStorageDeployment();

            storage.addDeployment(account.id, app.id, targetDeployment).then((targetDeploymentId: string) => {
              var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${targetDeployment.name}`;

              POST(url, {}, (location: string, promotedBody: any) => {
                assert.equal(promotedBody.package.packageHash, resultBody.package.packageHash);

                done();
              });
            });
          },
          getTestResource("test.zip")
        );
      });

      it("can promote a release to a different app version", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/release";

        var oldAppVersionPackage: storage.Package = testUtils.makePackage("1.0.0");
        oldAppVersionPackage.appVersion = "1.0.0";
        oldAppVersionPackage.description = "disabled package";
        oldAppVersionPackage.isMandatory = true;
        oldAppVersionPackage.isDisabled = false;

        POST(
          url,
          { packageInfo: oldAppVersionPackage },
          (location: string, resultBody: any) => {
            var targetDeployment: storage.Deployment = testUtils.makeStorageDeployment();

            storage.addDeployment(account.id, app.id, targetDeployment).then((targetDeploymentId: string) => {
              var url: string = `/apps/${app.name}/deployments/${deployment.name}/promote/${targetDeployment.name}`;

              POST(url, { packageInfo: { appVersion: "1.0.1" } }, (location: string, promotedBody: any) => {
                assert.equal(promotedBody.package.packageHash, resultBody.package.packageHash);
                assert.equal(promotedBody.package.appVersion, "1.0.1");

                done();
              });
            });
          },
          getTestResource("test.zip")
        );
      });
    });

    if (!useJsonStorage) {
      describe("PATCH release", () => {
        var otherApp: storage.App;
        var otherDeployment: storage.Deployment;
        var v1Package: storage.Package;
        var v2Package: storage.Package;

        beforeEach(function (done) {
          otherApp = testUtils.makeStorageApp();
          otherDeployment = testUtils.makeStorageDeployment();
          return storage
            .addApp(otherAccount.id, otherApp)
            .then((addedApp: storage.App) => {
              otherApp.id = addedApp.id;
              return storage.addDeployment(otherAccount.id, otherApp.id, otherDeployment);
            })
            .then((deploymentId: string) => {
              return storage.addCollaborator(otherAccount.id, otherApp.id, account.email);
            })
            .then(() => {
              var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
              v1Package = testUtils.makePackage();
              v1Package.blobUrl = "/resources/blob.zip";
              v1Package.description = packageDescription;
              v1Package.isMandatory = true;
              v1Package.manifestBlobUrl = null;
              v1Package.packageHash = "hash100";
              v1Package.appVersion = "1.0.0";
              POST(
                url,
                { packageInfo: v1Package },
                (location: string, result: any) => {
                  var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
                  v2Package = testUtils.makePackage();
                  v2Package.blobUrl = "/resources/test.zip";
                  v2Package.description = packageDescription;
                  v2Package.isMandatory = true;
                  v2Package.manifestBlobUrl = null;
                  v2Package.packageHash = "hash101";
                  v2Package.appVersion = "1.0.0";
                  v2Package.rollout = 25;
                  otherDeployment.package = v2Package;
                  POST(
                    url,
                    { packageInfo: v2Package },
                    (location: string, result: any) => {
                      done();
                    },
                    getTestResource("blob.zip")
                  );
                },
                getTestResource("test.zip")
              );
            });
        });

        it("returns 400 for invalid parameters", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            rollout: 123,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 400);
        });

        it("returns 404 for invalid app name", (done) => {
          var url: string = "/apps/invalidAppName/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            rollout: 30,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 404);
        });

        it("returns 404 for invalid deployment name", (done) => {
          var url: string = "/apps/" + otherApp.name + "deployments/invalidDepName/release";
          var toPatch: restTypes.PackageInfo = {
            rollout: 30,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 404);
        });

        it("returns 400 for non existent label", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            label: "nonExistentLabel",
            rollout: 30,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 400);
        });

        it("returns 409 for rollout value smaller than previous", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            rollout: 10,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 409);
        });

        it("returns 409 for patching rollout to a completed release", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            label: "v1",
            rollout: 50,
            description: "new description",
          };

          PATCH(url, { packageInfo: toPatch }, done, 409);
        });

        it("can successfully patch the latest release", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            appVersion: "1.0.1",
            description: "new description",
            isDisabled: true,
            isMandatory: false,
            rollout: 40,
          };

          PATCH(url, { packageInfo: toPatch }, () => {
            var historyUrl: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/history";
            GET(historyUrl, (response: any) => {
              var history: restTypes.Package[] = response.history;
              assert.notEqual(history.length, 0);

              var latest: restTypes.Package = history[history.length - 1];
              assert.equal(latest.rollout, toPatch.rollout);
              assert.equal(latest.description, toPatch.description);
              assert.equal(latest.isDisabled, toPatch.isDisabled);
              assert.equal(latest.isMandatory, toPatch.isMandatory);
              assert.equal(latest.appVersion, toPatch.appVersion);
              done();
            });
          });
        });

        it("can re-enable a release", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            label: "v2",
            isDisabled: true,
          };

          PATCH(url, { packageInfo: toPatch }, () => {
            toPatch.isDisabled = false;
            PATCH(url, { packageInfo: toPatch }, () => {
              var historyUrl: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/history";
              GET(historyUrl, (response: any) => {
                var history: restTypes.Package[] = response.history;
                assert.notEqual(history.length, 0);

                var latest: restTypes.Package = history[history.length - 1];
                assert.equal(latest.isDisabled, toPatch.isDisabled);
                done();
              });
            });
          });
        });

        it("patching rollout to 100% nullifies the value on release", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            rollout: 100,
          };

          PATCH(url, { packageInfo: toPatch }, () => {
            var historyUrl: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/history";
            GET(historyUrl, (response: any) => {
              var history: restTypes.Package[] = response.history;
              assert.notEqual(history.length, 0);

              var latest: restTypes.Package = history[history.length - 1];
              assert.equal(latest.rollout, null);
              done();
            });
          });
        });

        it("returns 204 for nothing to patch", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {};
          PATCH(url, toPatch, done, 204);
        });

        it("can patch release to a different appVersion", (done) => {
          var url: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/release";
          var toPatch: restTypes.PackageInfo = {
            appVersion: "2.0.0",
          };

          PATCH(url, { packageInfo: toPatch }, () => {
            var historyUrl: string = "/apps/" + otherApp.name + "/deployments/" + otherDeployment.name + "/history";
            GET(historyUrl, (response: any) => {
              var history: restTypes.Package[] = response.history;
              assert.notEqual(history.length, 0);

              var latest: restTypes.Package = history[history.length - 1];
              assert.equal(latest.appVersion, toPatch.appVersion);
              done();
            });
          });
        });
      });
    }

    describe("POST rollback", () => {
      it("returns 404 if nothing to rollback to", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback";
        POST(url, /*body=*/ {}, done, null, 404);
      });

      it("returns 409 if attempting to rollback to an older app store version", (done) => {
        var url = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.appVersion = "1.0.1";
        deployment.package = secondPackage;
        // Commit a second package with a newer version on top of the one already committed in the beforeEach()
        storage
          .commitPackage(account.id, app.id, deployment.id, deployment.package)
          .then(() => {
            POST(url, /*body=*/ {}, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 404 if rolling back to a label that does not exist", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v0";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.appVersion = "1.0.0";
        deployment.package = secondPackage;
        storage
          .commitPackage(account.id, app.id, deployment.id, deployment.package)
          .then(() => {
            POST(url, /*body=*/ {}, done, null, 404);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if rolling back to a package that is already the latest", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v2";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.appVersion = "1.0.0";
        deployment.package = secondPackage;
        storage
          .commitPackage(account.id, app.id, deployment.id, deployment.package)
          .then(() => {
            POST(url, /*body=*/ {}, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("returns 409 if rolling back to a label corresponding to a different app version", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v1";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.appVersion = "1.0.1";
        var thirdPackage = <storage.Package>JSON.parse(JSON.stringify(secondPackage));
        deployment.package = thirdPackage;
        // Commit two more packages with newer versions on top of the one already committed in the beforeEach()
        storage
          .commitPackage(account.id, app.id, deployment.id, secondPackage)
          .then(() => {
            return storage.commitPackage(account.id, app.id, deployment.id, thirdPackage);
          })
          .then(() => {
            POST(url, /*body=*/ {}, done, null, 409);
          })
          .catch(done)
          .done();
      });

      it("rolls back to previous package", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.description = "newPackageDescription";
        secondPackage.appVersion = "1.0.0";
        deployment.package = secondPackage;
        // Commit a second package on top of the one already committed in the beforeEach()
        storage
          .commitPackage(account.id, app.id, deployment.id, deployment.package)
          .then(() => {
            POST(url, /*body=*/ {}, (response: any) => {
              GET("/apps/" + app.name + "/deployments/" + deployment.name, (response: any) => {
                var restPackage: restTypes.Package = response.deployment.package;
                assert.equal(restPackage.description, packageDescription);
                assert.equal(restPackage.releaseMethod, "Rollback");
                assert.equal(restPackage.originalLabel, "v1");
                done();
              });
            });
          })
          .catch(done)
          .done();
      });

      it("rolls back to specific label", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v1";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.description = "newPackageDescription";
        secondPackage.appVersion = "1.0.0";
        deployment.package = secondPackage;
        var thirdPackage = <storage.Package>JSON.parse(JSON.stringify(secondPackage));
        deployment.package = thirdPackage;
        // Commit two packages on top of the one already committed in the beforeEach()
        storage
          .commitPackage(account.id, app.id, deployment.id, deployment.package)
          .then(() => {
            return storage.commitPackage(account.id, app.id, deployment.id, thirdPackage);
          })
          .then(() => {
            POST(url, /*body=*/ {}, (response: any) => {
              GET("/apps/" + app.name + "/deployments/" + deployment.name, (response: any) => {
                var restPackage: restTypes.Package = response.deployment.package;
                assert.equal(restPackage.description, packageDescription);
                assert.equal(restPackage.releaseMethod, "Rollback");
                assert.equal(restPackage.originalLabel, "v1");
                done();
              });
            });
          })
          .catch(done)
          .done();
      });

      it("can rollback to disabled release", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v2";
        var secondPackage: storage.Package = testUtils.makePackage();
        secondPackage.description = "newPackageDescription";
        secondPackage.appVersion = "1.0.0";
        secondPackage.isDisabled = true;

        var thirdPackage: storage.Package = testUtils.makePackage();
        thirdPackage.description = "newPackageDescription";
        thirdPackage.appVersion = "1.0.0";

        storage
          .commitPackage(account.id, app.id, deployment.id, secondPackage)
          .then(() => {
            return storage.commitPackage(account.id, app.id, deployment.id, thirdPackage);
          })
          .then(() => {
            POST(url, /*body=*/ {}, (response: any) => {
              GET("/apps/" + app.name + "/deployments/" + deployment.name, (response: any) => {
                var restPackage: restTypes.Package = response.deployment.package;
                assert.equal(restPackage.description, secondPackage.description);
                assert.equal(restPackage.releaseMethod, "Rollback");
                assert.equal(restPackage.isDisabled, true);
                assert.equal(restPackage.originalLabel, "v2");
                done();
              });
            });
          })
          .catch(done)
          .done();
      });

      it("rolls back with previous diff information", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback/v2";
        var secondPackage: storage.Package = testUtils.makePackage();

        secondPackage.blobUrl = "blobUrl2";
        secondPackage.diffPackageMap = { hash100: { url: "diffBlobUrl2", size: 1 } };
        secondPackage.description = "Test package for 1.0.0";
        secondPackage.isMandatory = false;
        secondPackage.packageHash = "hash101";
        secondPackage.label = "v2";
        secondPackage.appVersion = "1.0.0";
        secondPackage.size = 3;

        var thirdPackage: storage.Package = testUtils.makePackage();

        thirdPackage.blobUrl = "blobUrl3";
        thirdPackage.diffPackageMap = { hash101: { url: "diffBlobUrl3", size: 3 } };
        thirdPackage.description = "Test package for 1.0.0";
        thirdPackage.isMandatory = false;
        thirdPackage.packageHash = "hash102";
        thirdPackage.label = "v3";
        thirdPackage.appVersion = "1.0.0";
        thirdPackage.size = 4;

        storage
          .commitPackage(account.id, app.id, deployment.id, secondPackage)
          .then(() => {
            return storage.commitPackage(account.id, app.id, deployment.id, thirdPackage);
          })
          .then(() => {
            POST(url, /*objToSend*/ {}, (response: any) => {
              GET("/apps/" + app.name + "/deployments/" + deployment.name, (response: any) => {
                var restPackage: restTypes.Package = response.deployment.package;
                assert.equal(restPackage.description, packageDescription);
                assert.equal(restPackage.releaseMethod, "Rollback");
                assert.equal(restPackage.originalLabel, "v2");
                assert.deepEqual(restPackage.diffPackageMap, secondPackage.diffPackageMap);
                done();
              });
            });
          })
          .catch(done)
          .done();
      });

      it("rollback clears previous release's rollout", (done) => {
        var url: string = "/apps/" + app.name + "/deployments/" + deployment.name + "/rollback";
        var secondPackage: storage.Package = testUtils.makePackage();

        secondPackage.blobUrl = "blobUrl2";
        secondPackage.diffPackageMap = { hash100: { url: "diffBlobUrl2", size: 1 } };
        secondPackage.description = "Test package2 for 1.0.0";
        secondPackage.isMandatory = false;
        secondPackage.packageHash = "hash101";
        secondPackage.label = "v2";
        secondPackage.appVersion = "1.0.0";
        secondPackage.rollout = 20;
        secondPackage.size = 2;
        deployment.package = secondPackage;

        storage
          .commitPackage(account.id, app.id, deployment.id, secondPackage)
          .then(() => {
            POST(url, /*objToSend*/ {}, (response: any) => {
              GET("/apps/" + app.name + "/deployments/" + deployment.name + "/history", (response: any) => {
                var packageHistory: restTypes.Package[] = response.history;

                packageHistory.forEach((appPackage: restTypes.Package) => {
                  assert.equal(appPackage.rollout, null);
                });
                done();
              });
            });
          })
          .catch(done)
          .done();
      });
    });

    describe("GET collaborators", () => {
      beforeEach((done) => {
        storage.addCollaborator(account.id, app.id, otherAccount.email).then(() => {
          done();
        });
      });

      it("succeeds as owner", (done) => {
        GET("/apps/" + app.name + "/collaborators", (response: any) => {
          var collaboratorMap = <restTypes.CollaboratorMap>response.collaborators;
          assert(collaboratorMap);
          assert(collaboratorMap[account.email]);
          assert(collaboratorMap[account.email].permission === "Owner");
          assert(collaboratorMap[otherAccount.email]);
          assert(collaboratorMap[otherAccount.email].permission === "Collaborator");
          done();
        });
      });

      it("succeeds as collaborator", (done) => {
        var otherApp = testUtils.makeStorageApp();
        storage
          .addApp(otherAccount.id, otherApp)
          .then((storageApp) => {
            otherApp = storageApp;
            return storage.addCollaborator(otherAccount.id, otherApp.id, account.email);
          })
          .then(() => {
            GET("/apps/" + otherApp.name + "/collaborators", (response: any) => {
              var collaboratorMap = <restTypes.CollaboratorMap>response.collaborators;
              assert(collaboratorMap);
              assert(collaboratorMap[account.email]);
              assert(collaboratorMap[account.email].permission === "Collaborator");
              assert(collaboratorMap[otherAccount.email]);
              assert(collaboratorMap[otherAccount.email].permission === "Owner");
              done();
            });
          });
      });
    });

    describe("POST collaborators", () => {
      it("owner can add another collaborator", (done) => {
        POST("/apps/" + app.name + "/collaborators/" + otherAccount.email, {}, () => {
          GET("/apps/" + app.name + "/collaborators", (response: any) => {
            var collaboratorMap = <restTypes.CollaboratorMap>response.collaborators;
            assert(collaboratorMap);
            assert(collaboratorMap[otherAccount.email]);
            assert(collaboratorMap[otherAccount.email].permission === "Collaborator");
            done();
          });
        });
      });

      it("returns 409 if collaborator already exists", (done) => {
        POST("/apps/" + app.name + "/collaborators/" + otherAccount.email, {}, () => {
          POST("/apps/" + app.name + "/collaborators/" + otherAccount.email, {}, done, undefined, 409);
        });
      });
    });

    describe("DELETE collaborator", () => {
      beforeEach((done) => {
        storage.addCollaborator(account.id, app.id, otherAccount.email).then(() => {
          done();
        });
      });

      it("owner can delete a collaborator", (done) => {
        DELETE("/apps/" + app.name + "/collaborators/" + otherAccount.email, () => {
          done();
        });
      });

      it("returns 409 if owner tries to delete itself", (done) => {
        DELETE("/apps/" + app.name + "/collaborators/" + account.email, done, 409);
      });

      it("returns 404 if no such collaborator exists", (done) => {
        DELETE("/apps/" + app.name + "/collaborators/" + "not_a_real_email_address", done, 404);
      });

      describe("as collaborator", () => {
        var otherApp: storage.App;

        beforeEach((done) => {
          otherApp = testUtils.makeStorageApp();
          return storage
            .addApp(otherAccount.id, otherApp)
            .then((storageApp) => {
              otherApp = storageApp;
              return storage.addCollaborator(otherAccount.id, otherApp.id, account.email);
            })
            .then(() => {
              done();
            });
        });

        it("can delete itself", (done) => {
          DELETE("/apps/" + otherApp.name + "/collaborators/" + account.email, () => {
            done();
          });
        });

        it("returns 403 if attempting to delete owner", (done) => {
          DELETE("/apps/" + otherApp.name + "/collaborators/" + otherAccount.email, done, 403);
        });

        it("returns 403 if attempting to delete another collaborator", (done) => {
          var thirdAccount = testUtils.makeAccount();
          storage
            .addAccount(thirdAccount)
            .then((thirdAccountId) => {
              thirdAccount.id = thirdAccountId;
              return storage.addCollaborator(otherAccount.id, otherApp.id, thirdAccount.email);
            })
            .then(() => {
              DELETE("/apps/" + otherApp.name + "/collaborators/" + thirdAccount.email, done, 403);
            });
        });
      });
    });

    describe("returns 403 when collaborator tries to", () => {
      var otherApp: storage.App;
      var otherDeployment: storage.Deployment;

      beforeEach((done) => {
        storage
          .addApp(otherAccount.id, testUtils.makeStorageApp())
          .then((storageApp) => {
            otherApp = storageApp;
            return storage.addCollaborator(otherAccount.id, otherApp.id, account.email);
          })
          .then(() => {
            otherDeployment = testUtils.makeStorageDeployment();
            return storage.addDeployment(otherAccount.id, otherApp.id, otherDeployment);
          })
          .then((deploymentId) => {
            otherDeployment.id = deploymentId;
            done();
          });
      });

      it("add another collaborator", (done) => {
        var thirdAccount = testUtils.makeAccount();
        storage.addAccount(thirdAccount).then((thirdAccountId) => {
          thirdAccount.id = thirdAccountId;
          POST("/apps/" + otherApp.name + "/collaborators/" + thirdAccount.email, {}, done, null, 403);
        });
      });

      it("update app", (done) => {
        var patchedApp: restTypes.App = { name: "dummy_name" };
        PATCH("/apps/" + otherApp.name, patchedApp, done, 403);
      });

      it("add deployment", (done) => {
        POST("/apps/" + otherApp.name + "/deployments", testUtils.makeStorageDeployment(), done, null, 403);
      });

      it("delete deployment", (done) => {
        DELETE("/apps/" + otherApp.name + "/deployments/" + otherDeployment.name, done, 403);
      });

      it("update deployment", (done) => {
        var patchedDeployment: restTypes.Deployment = { name: "dummy_name" };
        PATCH("/apps/" + otherApp.name + "/deployments/" + otherDeployment.name, patchedDeployment, done, 403);
      });
    });
  });

  // This function wraps the Supertest scaffolding for a simple, non-customizable Get
  function GET(
    url: string,
    callback: (response: any, headers: any) => void,
    expect: number | Object = 200 /*OK*/,
    accessKeyOverride?: string
  ): void {
    request(server || serverUrl)
      .get(url)
      .expect(expect)
      .set("Authorization", `Bearer ${accessKeyOverride || accessKey.name}`)
      .end(function (err: any, result: any) {
        if (err) throw err;
        try {
          var response = result.text ? JSON.parse(result.text) : null;
        } catch (ex) {
          // Ignore parsing error
        }
        callback(response, result.headers);
      });
  }

  function POST(
    url: string,
    objToSend: any,
    callback: (location: string, resultBody?: any) => void,
    fileToUpload?: string,
    statusCode = 201 /* Created */
  ): void {
    var newRequest: superagent.Request<any> = request(server || serverUrl)
      .post(url)
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${accessKey.name}`)
      .expect(statusCode);

    if (fileToUpload) {
      Object.keys(objToSend).forEach((key: string) => (newRequest = newRequest.field(key, JSON.stringify(objToSend[key]))));
      newRequest.attach("package", <any>fs.createReadStream(fileToUpload));
    } else {
      newRequest.send(JSON.stringify(objToSend));
    }

    newRequest.end(function (err: any, result: any) {
      if (err) throw err;
      callback(result.headers["location"], result.body);
    });
  }

  // This function wraps the Supertest setup for a simple PATCH to update an item
  function PATCH(url: string, objToSend: any, callback: () => void, statusCode = 200 /* OK */): void {
    request(server || serverUrl)
      .patch(url)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(objToSend))
      .expect(statusCode)
      .set("Authorization", `Bearer ${accessKey.name}`)
      .end(function (err: any, result: any) {
        if (err) throw err;
        callback();
      });
  }

  function DELETE(url: string, callback: () => void, statusCode = 204 /* No Content */): void {
    request(server || serverUrl)
      .delete(url)
      .expect(statusCode)
      .set("Authorization", `Bearer ${accessKey.name}`)
      .end(function (err: any, result: any) {
        if (err) throw err;
        callback();
      });
  }

  function getTestResource(resourceName: string): string {
    return path.join(__dirname, "resources", resourceName);
  }
}
