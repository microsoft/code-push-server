"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SdkStub = void 0;
const assert = require("assert");
const sinon = require("sinon");
const Q = require("q");
const path = require("path");
const cli = require("../script/types/cli");
const cmdexec = require("../script/command-executor");
const os = require("os");
function assertJsonDescribesObject(json, object) {
    // Make sure JSON is indented correctly
    assert.equal(json, JSON.stringify(object, /*replacer=*/ null, /*spacing=*/ 2));
}
function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function ensureInTestAppDirectory() {
    if (!~__dirname.indexOf("/resources/TestApp")) {
        process.chdir(__dirname + "/resources/TestApp");
    }
}
function isDefined(object) {
    return object !== undefined && object !== null;
}
const NOW = 1471460856191;
const DEFAULT_ACCESS_KEY_MAX_AGE = 1000 * 60 * 60 * 24 * 60; // 60 days
const TEST_MACHINE_NAME = "Test machine";
class SdkStub {
    productionDeployment = {
        name: "Production",
        key: "6",
    };
    stagingDeployment = {
        name: "Staging",
        key: "6",
        package: {
            appVersion: "1.0.0",
            description: "fgh",
            label: "v2",
            packageHash: "jkl",
            isMandatory: true,
            size: 10,
            blobUrl: "http://mno.pqr",
            uploadTime: 1000,
        },
    };
    getAccountInfo() {
        return Q({
            email: "a@a.com",
        });
    }
    addAccessKey(name, ttl) {
        return Q({
            key: "key123",
            createdTime: new Date().getTime(),
            name,
            expires: NOW + (isDefined(ttl) ? ttl : DEFAULT_ACCESS_KEY_MAX_AGE),
        });
    }
    patchAccessKey(newName, newTtl) {
        return Q({
            createdTime: new Date().getTime(),
            name: newName,
            expires: NOW + (isDefined(newTtl) ? newTtl : DEFAULT_ACCESS_KEY_MAX_AGE),
        });
    }
    addApp(name) {
        return Q({
            name: name,
        });
    }
    addCollaborator() {
        return Q(null);
    }
    addDeployment(deploymentName) {
        return Q({
            name: deploymentName,
            key: "6",
        });
    }
    clearDeploymentHistory() {
        return Q(null);
    }
    getAccessKeys() {
        return Q([
            {
                createdTime: 0,
                name: "Test name",
                expires: NOW + DEFAULT_ACCESS_KEY_MAX_AGE,
            },
        ]);
    }
    getSessions() {
        return Q([
            {
                loggedInTime: 0,
                machineName: TEST_MACHINE_NAME,
            },
        ]);
    }
    getApps() {
        return Q([
            {
                name: "a",
                collaborators: {
                    "a@a.com": { permission: "Owner", isCurrentAccount: true },
                },
                deployments: ["Production", "Staging"],
            },
            {
                name: "b",
                collaborators: {
                    "a@a.com": { permission: "Owner", isCurrentAccount: true },
                },
                deployments: ["Production", "Staging"],
            },
        ]);
    }
    getDeployments(appName) {
        if (appName === "a") {
            return Q([this.productionDeployment, this.stagingDeployment]);
        }
        return Q.reject();
    }
    getDeployment(appName, deploymentName) {
        if (appName === "a") {
            if (deploymentName === "Production") {
                return Q(this.productionDeployment);
            }
            else if (deploymentName === "Staging") {
                return Q(this.stagingDeployment);
            }
        }
        return Q.reject();
    }
    getDeploymentHistory() {
        return Q([
            {
                description: null,
                appVersion: "1.0.0",
                isMandatory: false,
                packageHash: "463acc7d06adc9c46233481d87d9e8264b3e9ffe60fe98d721e6974209dc71a0",
                blobUrl: "https://fakeblobstorage.net/storagev2/blobid1",
                uploadTime: 1447113596270,
                size: 1,
                label: "v1",
            },
            {
                description: "New update - this update does a whole bunch of things, including testing linewrapping",
                appVersion: "1.0.1",
                isMandatory: false,
                packageHash: "463acc7d06adc9c46233481d87d9e8264b3e9ffe60fe98d721e6974209dc71a0",
                blobUrl: "https://fakeblobstorage.net/storagev2/blobid2",
                uploadTime: 1447118476669,
                size: 2,
                label: "v2",
            },
        ]);
    }
    getDeploymentMetrics() {
        return Q({
            "1.0.0": {
                active: 123,
            },
            v1: {
                active: 789,
                downloaded: 456,
                failed: 654,
                installed: 987,
            },
            v2: {
                active: 123,
                downloaded: 321,
                failed: 789,
                installed: 456,
            },
        });
    }
    getCollaborators() {
        return Q({
            "a@a.com": {
                permission: "Owner",
                isCurrentAccount: true,
            },
            "b@b.com": {
                permission: "Collaborator",
                isCurrentAccount: false,
            },
        });
    }
    patchRelease() {
        return Q(null);
    }
    promote() {
        return Q(null);
    }
    release() {
        return Q("Successfully released");
    }
    removeAccessKey() {
        return Q(null);
    }
    removeApp() {
        return Q(null);
    }
    removeCollaborator() {
        return Q(null);
    }
    removeDeployment() {
        return Q(null);
    }
    removeSession() {
        return Q(null);
    }
    renameApp() {
        return Q(null);
    }
    rollback() {
        return Q(null);
    }
    transferApp() {
        return Q(null);
    }
    renameDeployment() {
        return Q(null);
    }
}
exports.SdkStub = SdkStub;
describe("CLI", () => {
    var log;
    var sandbox;
    var spawn;
    var wasConfirmed = true;
    const INVALID_RELEASE_FILE_ERROR_MESSAGE = "It is unnecessary to package releases in a .zip or binary file. Please specify the direct path to the update content's directory (e.g. /platforms/ios/www) or file (e.g. main.jsbundle).";
    beforeEach(() => {
        wasConfirmed = true;
        sandbox = sinon.createSandbox();
        sandbox.stub(cmdexec, "confirm").returns(Q.Promise((resolve) => {
            resolve(wasConfirmed);
        }));
        sandbox.stub(cmdexec, "createEmptyTempReleaseFolder").callsFake(() => Q.Promise((resolve) => resolve()));
        log = sandbox.stub(cmdexec, "log").callsFake(() => { });
        spawn = sandbox.stub(cmdexec, "spawn").callsFake(() => {
            return {
                stdout: { on: () => { } },
                stderr: { on: () => { } },
                on: (event, callback) => {
                    callback();
                },
            };
        });
    });
    afterEach(() => {
        sandbox.restore();
    });
    it("accessKeyAdd creates access key with name and default ttl", (done) => {
        var command = {
            type: cli.CommandType.accessKeyAdd,
            name: "Test name",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledTwice(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = `Successfully created the "Test name" access key: key123`;
            assert.equal(actual, expected);
            actual = log.args[1][0];
            expected = "Make sure to save this key value somewhere safe, since you won't be able to view it from the CLI again!";
            assert.equal(actual, expected);
            done();
        });
    });
    it("accessKeyAdd creates access key with name and specified ttl", (done) => {
        var ttl = 10000;
        var command = {
            type: cli.CommandType.accessKeyAdd,
            name: "Test name",
            ttl,
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledTwice(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = `Successfully created the "Test name" access key: key123`;
            assert.equal(actual, expected);
            actual = log.args[1][0];
            expected = "Make sure to save this key value somewhere safe, since you won't be able to view it from the CLI again!";
            assert.equal(actual, expected);
            done();
        });
    });
    it("accessKeyPatch updates access key with new name", (done) => {
        var command = {
            type: cli.CommandType.accessKeyPatch,
            oldName: "Test name",
            newName: "Updated name",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = `Successfully renamed the access key "Test name" to "Updated name".`;
            assert.equal(actual, expected);
            done();
        });
    });
    it("accessKeyPatch updates access key with new ttl", (done) => {
        var ttl = 10000;
        var command = {
            type: cli.CommandType.accessKeyPatch,
            oldName: "Test name",
            ttl,
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = `Successfully changed the expiration date of the "Test name" access key to Wednesday, August 17, 2016 12:07 PM.`;
            assert.equal(actual, expected);
            done();
        });
    });
    it("accessKeyPatch updates access key with new name and ttl", (done) => {
        var ttl = 10000;
        var command = {
            type: cli.CommandType.accessKeyPatch,
            oldName: "Test name",
            newName: "Updated name",
            ttl,
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = `Successfully renamed the access key "Test name" to "Updated name" and changed its expiration date to Wednesday, August 17, 2016 12:07 PM.`;
            assert.equal(actual, expected);
            done();
        });
    });
    it("accessKeyList lists access key name and expires fields", (done) => {
        var command = {
            type: cli.CommandType.accessKeyList,
            format: "json",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = [
                {
                    createdTime: 0,
                    name: "Test name",
                    expires: NOW + DEFAULT_ACCESS_KEY_MAX_AGE,
                },
            ];
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("accessKeyRemove removes access key", (done) => {
        var command = {
            type: cli.CommandType.accessKeyRemove,
            accessKey: "8",
        };
        var removeAccessKey = sandbox.spy(cmdexec.sdk, "removeAccessKey");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(removeAccessKey);
            sinon.assert.calledWithExactly(removeAccessKey, "8");
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully removed the "8" access key.');
            done();
        });
    });
    it("accessKeyRemove does not remove access key if cancelled", (done) => {
        var command = {
            type: cli.CommandType.accessKeyRemove,
            accessKey: "8",
        };
        var removeAccessKey = sandbox.spy(cmdexec.sdk, "removeAccessKey");
        wasConfirmed = false;
        cmdexec.execute(command).done(() => {
            sinon.assert.notCalled(removeAccessKey);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, "Access key removal cancelled.");
            done();
        });
    });
    it("appAdd reports new app name and ID", (done) => {
        var command = {
            type: cli.CommandType.appAdd,
            appName: "a",
            os: "",
            platform: "",
        };
        var addApp = sandbox.spy(cmdexec.sdk, "addApp");
        var deploymentList = sandbox.spy(cmdexec, "deploymentList");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(addApp);
            sinon.assert.calledTwice(log);
            sinon.assert.calledWithExactly(log, 'Successfully added the "a" app, along with the following default deployments:');
            sinon.assert.calledOnce(deploymentList);
            done();
        });
    });
    it("appList lists app names and ID's", (done) => {
        var command = {
            type: cli.CommandType.appList,
            format: "json",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = [
                {
                    name: "a",
                    collaborators: {
                        "a@a.com": {
                            permission: "Owner",
                            isCurrentAccount: true,
                        },
                    },
                    deployments: ["Production", "Staging"],
                },
                {
                    name: "b",
                    collaborators: {
                        "a@a.com": {
                            permission: "Owner",
                            isCurrentAccount: true,
                        },
                    },
                    deployments: ["Production", "Staging"],
                },
            ];
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("appRemove removes app", (done) => {
        var command = {
            type: cli.CommandType.appRemove,
            appName: "a",
        };
        var removeApp = sandbox.spy(cmdexec.sdk, "removeApp");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(removeApp);
            sinon.assert.calledWithExactly(removeApp, "a");
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully removed the "a" app.');
            done();
        });
    });
    it("appRemove does not remove app if cancelled", (done) => {
        var command = {
            type: cli.CommandType.appRemove,
            appName: "a",
        };
        var removeApp = sandbox.spy(cmdexec.sdk, "removeApp");
        wasConfirmed = false;
        cmdexec.execute(command).done(() => {
            sinon.assert.notCalled(removeApp);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, "App removal cancelled.");
            done();
        });
    });
    it("appRename renames app", (done) => {
        var command = {
            type: cli.CommandType.appRename,
            currentAppName: "a",
            newAppName: "c",
        };
        var renameApp = sandbox.spy(cmdexec.sdk, "renameApp");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(renameApp);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully renamed the "a" app to "c".');
            done();
        });
    });
    it("appTransfer transfers app", (done) => {
        var command = {
            type: cli.CommandType.appTransfer,
            appName: "a",
            email: "b@b.com",
        };
        var transferApp = sandbox.spy(cmdexec.sdk, "transferApp");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(transferApp);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully transferred the ownership of app "a" to the account with email "b@b.com".');
            done();
        });
    });
    it("collaboratorAdd adds collaborator", (done) => {
        var command = {
            type: cli.CommandType.collaboratorAdd,
            appName: "a",
            email: "b@b.com",
        };
        var addCollaborator = sandbox.spy(cmdexec.sdk, "addCollaborator");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(addCollaborator);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully added "b@b.com" as a collaborator to the app "a".');
            done();
        });
    });
    it("collaboratorList lists collaborators email and properties", (done) => {
        var command = {
            type: cli.CommandType.collaboratorList,
            appName: "a",
            format: "json",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = {
                collaborators: {
                    "a@a.com": { permission: "Owner", isCurrentAccount: true },
                    "b@b.com": { permission: "Collaborator", isCurrentAccount: false },
                },
            };
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("collaboratorRemove removes collaborator", (done) => {
        var command = {
            type: cli.CommandType.collaboratorRemove,
            appName: "a",
            email: "b@b.com",
        };
        var removeCollaborator = sandbox.spy(cmdexec.sdk, "removeCollaborator");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(removeCollaborator);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully removed "b@b.com" as a collaborator from the app "a".');
            done();
        });
    });
    it("deploymentAdd reports new app name and ID", (done) => {
        var command = {
            type: cli.CommandType.deploymentAdd,
            appName: "a",
            deploymentName: "b",
            default: false,
        };
        var addDeployment = sandbox.spy(cmdexec.sdk, "addDeployment");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(addDeployment);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully added the "b" deployment with key "6" to the "a" app.');
            done();
        });
    });
    it("deploymentHistoryClear clears deployment", (done) => {
        var command = {
            type: cli.CommandType.deploymentHistoryClear,
            appName: "a",
            deploymentName: "Staging",
        };
        var clearDeployment = sandbox.spy(cmdexec.sdk, "clearDeploymentHistory");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(clearDeployment);
            sinon.assert.calledWithExactly(clearDeployment, "a", "Staging");
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully cleared the release history associated with the "Staging" deployment from the "a" app.');
            done();
        });
    });
    it("deploymentHistoryClear does not clear deployment if cancelled", (done) => {
        var command = {
            type: cli.CommandType.deploymentHistoryClear,
            appName: "a",
            deploymentName: "Staging",
        };
        var clearDeployment = sandbox.spy(cmdexec.sdk, "clearDeploymentHistory");
        wasConfirmed = false;
        cmdexec.execute(command).done(() => {
            sinon.assert.notCalled(clearDeployment);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, "Clear deployment cancelled.");
            done();
        });
    });
    it("deploymentList lists deployment names, deployment keys, and package information", (done) => {
        var command = {
            type: cli.CommandType.deploymentList,
            appName: "a",
            format: "json",
            displayKeys: true,
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = [
                {
                    name: "Production",
                    key: "6",
                },
                {
                    name: "Staging",
                    key: "6",
                    package: {
                        appVersion: "1.0.0",
                        description: "fgh",
                        label: "v2",
                        packageHash: "jkl",
                        isMandatory: true,
                        size: 10,
                        blobUrl: "http://mno.pqr",
                        uploadTime: 1000,
                        metrics: {
                            active: 123,
                            downloaded: 321,
                            failed: 789,
                            installed: 456,
                            totalActive: 1035,
                        },
                    },
                },
            ];
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("deploymentRemove removes deployment", (done) => {
        var command = {
            type: cli.CommandType.deploymentRemove,
            appName: "a",
            deploymentName: "Staging",
        };
        var removeDeployment = sandbox.spy(cmdexec.sdk, "removeDeployment");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(removeDeployment);
            sinon.assert.calledWithExactly(removeDeployment, "a", "Staging");
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully removed the "Staging" deployment from the "a" app.');
            done();
        });
    });
    it("deploymentRemove does not remove deployment if cancelled", (done) => {
        var command = {
            type: cli.CommandType.deploymentRemove,
            appName: "a",
            deploymentName: "Staging",
        };
        var removeDeployment = sandbox.spy(cmdexec.sdk, "removeDeployment");
        wasConfirmed = false;
        cmdexec.execute(command).done(() => {
            sinon.assert.notCalled(removeDeployment);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, "Deployment removal cancelled.");
            done();
        });
    });
    it("deploymentRename renames deployment", (done) => {
        var command = {
            type: cli.CommandType.deploymentRename,
            appName: "a",
            currentDeploymentName: "Staging",
            newDeploymentName: "c",
        };
        var renameDeployment = sandbox.spy(cmdexec.sdk, "renameDeployment");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(renameDeployment);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, 'Successfully renamed the "Staging" deployment to "c" for the "a" app.');
            done();
        });
    });
    it("deploymentHistory lists package history information", (done) => {
        var command = {
            type: cli.CommandType.deploymentHistory,
            appName: "a",
            deploymentName: "Staging",
            format: "json",
            displayAuthor: false,
        };
        var getDeploymentHistory = sandbox.spy(cmdexec.sdk, "getDeploymentHistory");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(getDeploymentHistory);
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = [
                {
                    description: null,
                    appVersion: "1.0.0",
                    isMandatory: false,
                    packageHash: "463acc7d06adc9c46233481d87d9e8264b3e9ffe60fe98d721e6974209dc71a0",
                    blobUrl: "https://fakeblobstorage.net/storagev2/blobid1",
                    uploadTime: 1447113596270,
                    size: 1,
                    label: "v1",
                },
                {
                    description: "New update - this update does a whole bunch of things, including testing linewrapping",
                    appVersion: "1.0.1",
                    isMandatory: false,
                    packageHash: "463acc7d06adc9c46233481d87d9e8264b3e9ffe60fe98d721e6974209dc71a0",
                    blobUrl: "https://fakeblobstorage.net/storagev2/blobid2",
                    uploadTime: 1447118476669,
                    size: 2,
                    label: "v2",
                },
            ];
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("patch command successfully updates specific label", (done) => {
        var command = {
            type: cli.CommandType.patch,
            appName: "a",
            deploymentName: "Staging",
            label: "v1",
            disabled: false,
            description: "Patched",
            mandatory: true,
            rollout: 25,
            appStoreVersion: "1.0.1",
        };
        var patch = sandbox.spy(cmdexec.sdk, "patchRelease");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(patch);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully updated the "v1" release of "a" app's "Staging" deployment.`);
            done();
        });
    });
    it("patch command successfully updates latest release", (done) => {
        var command = {
            type: cli.CommandType.patch,
            appName: "a",
            deploymentName: "Staging",
            label: null,
            disabled: false,
            description: "Patched",
            mandatory: true,
            rollout: 25,
            appStoreVersion: "1.0.1",
        };
        var patch = sandbox.spy(cmdexec.sdk, "patchRelease");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(patch);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully updated the "latest" release of "a" app's "Staging" deployment.`);
            done();
        });
    });
    it("patch command successfully updates without appStoreVersion", (done) => {
        var command = {
            type: cli.CommandType.patch,
            appName: "a",
            deploymentName: "Staging",
            label: null,
            disabled: false,
            description: "Patched",
            mandatory: true,
            rollout: 25,
            appStoreVersion: null,
        };
        var patch = sandbox.spy(cmdexec.sdk, "patchRelease");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(patch);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully updated the "latest" release of "a" app's "Staging" deployment.`);
            done();
        });
    });
    it("patch command fails if no properties were specified for update", (done) => {
        var command = {
            type: cli.CommandType.patch,
            appName: "a",
            deploymentName: "Staging",
            label: null,
            disabled: null,
            description: null,
            mandatory: null,
            rollout: null,
            appStoreVersion: null,
        };
        var patch = sandbox.spy(cmdexec.sdk, "patchRelease");
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch((err) => {
            assert.equal(err.message, "At least one property must be specified to patch a release.");
            sinon.assert.notCalled(patch);
            done();
        })
            .done();
    });
    it("promote works successfully", (done) => {
        var command = {
            type: cli.CommandType.promote,
            appName: "a",
            sourceDeploymentName: "Staging",
            destDeploymentName: "Production",
            description: "Promoted",
            mandatory: true,
            rollout: 25,
            appStoreVersion: "1.0.1",
        };
        var promote = sandbox.spy(cmdexec.sdk, "promote");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(promote);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully promoted the "Staging" deployment of the "a" app to the "Production" deployment.`);
            done();
        });
    });
    it("promote works successfully without appStoreVersion", (done) => {
        var command = {
            type: cli.CommandType.promote,
            appName: "a",
            sourceDeploymentName: "Staging",
            destDeploymentName: "Production",
            description: "Promoted",
            mandatory: true,
            rollout: 25,
            appStoreVersion: null,
        };
        var promote = sandbox.spy(cmdexec.sdk, "promote");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(promote);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully promoted the "Staging" deployment of the "a" app to the "Production" deployment.`);
            done();
        });
    });
    it("rollback works successfully", (done) => {
        var command = {
            type: cli.CommandType.rollback,
            appName: "a",
            deploymentName: "Staging",
            targetRelease: "v2",
        };
        var rollback = sandbox.spy(cmdexec.sdk, "rollback");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(rollback);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully performed a rollback on the "Staging" deployment of the "a" app.`);
            done();
        });
    });
    it("release doesn't allow non valid semver ranges", (done) => {
        var command = {
            type: cli.CommandType.release,
            appName: "a",
            deploymentName: "Staging",
            description: "test releasing zip file",
            mandatory: false,
            rollout: null,
            appStoreVersion: "not semver",
            package: "./resources",
        };
        releaseHelperFunction(command, done, 'Please use a semver-compliant target binary version range, for example "1.0.0", "*" or "^1.2.3".');
    });
    it("release doesn't allow releasing .zip file", (done) => {
        var command = {
            type: cli.CommandType.release,
            appName: "a",
            deploymentName: "Staging",
            description: "test releasing zip file",
            mandatory: false,
            rollout: null,
            appStoreVersion: "1.0.0",
            package: "/fake/path/test/file.zip",
        };
        releaseHelperFunction(command, done, INVALID_RELEASE_FILE_ERROR_MESSAGE);
    });
    it("release doesn't allow releasing .ipa file", (done) => {
        var command = {
            type: cli.CommandType.release,
            appName: "a",
            deploymentName: "Staging",
            description: "test releasing ipa file",
            mandatory: false,
            rollout: null,
            appStoreVersion: "1.0.0",
            package: "/fake/path/test/file.ipa",
        };
        releaseHelperFunction(command, done, INVALID_RELEASE_FILE_ERROR_MESSAGE);
    });
    it("release doesn't allow releasing .apk file", (done) => {
        var command = {
            type: cli.CommandType.release,
            appName: "a",
            deploymentName: "Staging",
            description: "test releasing apk file",
            mandatory: false,
            rollout: null,
            appStoreVersion: "1.0.0",
            package: "/fake/path/test/file.apk",
        };
        releaseHelperFunction(command, done, INVALID_RELEASE_FILE_ERROR_MESSAGE);
    });
    it("release-react fails if CWD does not contain package.json", (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test invalid folder",
            mandatory: false,
            rollout: null,
            platform: "ios",
        };
        var release = sandbox.spy(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch((err) => {
            assert.equal(err.message, 'Unable to find or read "package.json" in the CWD. The "release-react" command must be executed in a React Native project folder.');
            sinon.assert.notCalled(release);
            sinon.assert.notCalled(spawn);
            done();
        })
            .done();
    });
    it("release-react fails if entryFile does not exist", (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test invalid entryFile",
            entryFile: "doesntexist.js",
            mandatory: false,
            rollout: null,
            platform: "ios",
        };
        ensureInTestAppDirectory();
        var release = sandbox.spy(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch((err) => {
            assert.equal(err.message, 'Entry file "doesntexist.js" does not exist.');
            sinon.assert.notCalled(release);
            sinon.assert.notCalled(spawn);
            done();
        })
            .done();
    });
    it("release-react fails if platform is invalid", (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test invalid platform",
            mandatory: false,
            rollout: null,
            platform: "blackberry",
        };
        ensureInTestAppDirectory();
        var release = sandbox.spy(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch((err) => {
            assert.equal(err.message, 'Platform must be either "android", "ios" or "windows".');
            sinon.assert.notCalled(release);
            sinon.assert.notCalled(spawn);
            done();
        })
            .done();
    });
    it("release-react fails if targetBinaryRange is not a valid semver range expression", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: "notsemver",
            bundleName: bundleName,
            deploymentName: "Staging",
            description: "Test uses targetBinaryRange",
            mandatory: false,
            rollout: null,
            platform: "android",
            sourcemapOutput: "index.android.js.map",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch((err) => {
            assert.equal(err.message, 'Please use a semver-compliant target binary version range, for example "1.0.0", "*" or "^1.2.3".');
            sinon.assert.notCalled(release);
            sinon.assert.notCalled(spawn);
            done();
        })
            .done();
    });
    it("release-react defaults entry file to index.{platform}.js if not provided", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            bundleName: bundleName,
            deploymentName: "Staging",
            description: "Test default entry file",
            mandatory: false,
            rollout: null,
            platform: "ios",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = command;
            releaseCommand.package = path.join(os.tmpdir(), "CodePush");
            releaseCommand.appStoreVersion = "1.2.3";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${path.join(os.tmpdir(), "CodePush")} --bundle-output ${path.join(os.tmpdir(), "CodePush", bundleName)} --dev false --entry-file index.ios.js --platform ios`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it('release-react defaults bundle name to "main.jsbundle" if not provided and platform is "ios"', (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test default entry file",
            mandatory: false,
            rollout: null,
            platform: "ios",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = clone(command);
            var packagePath = path.join(os.tmpdir(), "CodePush");
            releaseCommand.package = packagePath;
            releaseCommand.appStoreVersion = "1.2.3";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${packagePath} --bundle-output ${path.join(packagePath, "main.jsbundle")} --dev false --entry-file index.ios.js --platform ios`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it('release-react defaults bundle name to "index.android.bundle" if not provided and platform is "android"', (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test default entry file",
            mandatory: false,
            rollout: null,
            platform: "android",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = clone(command);
            var packagePath = path.join(os.tmpdir(), "CodePush");
            releaseCommand.package = packagePath;
            releaseCommand.appStoreVersion = "1.0.0";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${packagePath} --bundle-output ${path.join(packagePath, "index.android.bundle")} --dev false --entry-file index.android.js --platform android`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it('release-react defaults bundle name to "index.windows.bundle" if not provided and platform is "windows"', (done) => {
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            deploymentName: "Staging",
            description: "Test default entry file",
            mandatory: false,
            rollout: null,
            platform: "windows",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = clone(command);
            var packagePath = path.join(os.tmpdir(), "CodePush");
            releaseCommand.package = packagePath;
            releaseCommand.appStoreVersion = "1.0.0";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${packagePath} --bundle-output ${path.join(packagePath, "index.windows.bundle")} --dev false --entry-file index.windows.js --platform windows`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it("release-react generates dev bundle", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            bundleName: bundleName,
            deploymentName: "Staging",
            development: true,
            description: "Test generates dev bundle",
            mandatory: false,
            rollout: null,
            platform: "android",
            sourcemapOutput: "index.android.js.map",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = command;
            releaseCommand.package = path.join(os.tmpdir(), "CodePush");
            releaseCommand.appStoreVersion = "1.2.3";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${path.join(os.tmpdir(), "CodePush")} --bundle-output ${path.join(os.tmpdir(), "CodePush", bundleName)} --dev true --entry-file index.android.js --platform android --sourcemap-output index.android.js.map`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it("release-react generates sourcemaps", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            bundleName: bundleName,
            deploymentName: "Staging",
            description: "Test generates sourcemaps",
            mandatory: false,
            rollout: null,
            platform: "android",
            sourcemapOutput: "index.android.js.map",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = command;
            releaseCommand.package = path.join(os.tmpdir(), "CodePush");
            releaseCommand.appStoreVersion = "1.2.3";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${path.join(os.tmpdir(), "CodePush")} --bundle-output ${path.join(os.tmpdir(), "CodePush", bundleName)} --dev false --entry-file index.android.js --platform android --sourcemap-output index.android.js.map`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it("release-react uses specified targetBinaryRange option", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: ">=1.0.0 <1.0.5",
            bundleName: bundleName,
            deploymentName: "Staging",
            description: "Test uses targetBinaryRange",
            mandatory: false,
            rollout: null,
            platform: "android",
            sourcemapOutput: "index.android.js.map",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = command;
            releaseCommand.package = path.join(os.tmpdir(), "CodePush");
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${path.join(os.tmpdir(), "CodePush")} --bundle-output ${path.join(os.tmpdir(), "CodePush", bundleName)} --dev false --entry-file index.android.js --platform android --sourcemap-output index.android.js.map`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            done();
        })
            .done();
    });
    it("release-react applies arguments to node binary provided via the CODE_PUSH_NODE_ARGS env var", (done) => {
        var bundleName = "bundle.js";
        var command = {
            type: cli.CommandType.releaseReact,
            appName: "a",
            appStoreVersion: null,
            bundleName: bundleName,
            deploymentName: "Staging",
            description: "Test default entry file",
            mandatory: false,
            rollout: null,
            platform: "ios",
        };
        ensureInTestAppDirectory();
        var release = sandbox.stub(cmdexec, "release");
        var _CODE_PUSH_NODE_ARGS = process.env.CODE_PUSH_NODE_ARGS;
        process.env.CODE_PUSH_NODE_ARGS = "  --foo=bar    --baz  ";
        cmdexec
            .execute(command)
            .then(() => {
            var releaseCommand = command;
            releaseCommand.package = path.join(os.tmpdir(), "CodePush");
            releaseCommand.appStoreVersion = "1.2.3";
            sinon.assert.calledOnce(spawn);
            var spawnCommand = spawn.args[0][0];
            var spawnCommandArgs = spawn.args[0][1].join(" ");
            assert.equal(spawnCommand, "node");
            assert.equal(spawnCommandArgs, `--foo=bar --baz ${path.join("node_modules", "react-native", "local-cli", "cli.js")} bundle --assets-dest ${path.join(os.tmpdir(), "CodePush")} --bundle-output ${path.join(os.tmpdir(), "CodePush", bundleName)} --dev false --entry-file index.ios.js --platform ios`);
            assertJsonDescribesObject(JSON.stringify(release.args[0][0], /*replacer=*/ null, /*spacing=*/ 2), releaseCommand);
            process.env.CODE_PUSH_NODE_ARGS = _CODE_PUSH_NODE_ARGS;
            done();
        })
            .done();
    });
    it("sessionList lists session name and expires fields", (done) => {
        var command = {
            type: cli.CommandType.sessionList,
            format: "json",
        };
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(log);
            assert.equal(log.args[0].length, 1);
            var actual = log.args[0][0];
            var expected = [
                {
                    loggedInTime: 0,
                    machineName: TEST_MACHINE_NAME,
                },
            ];
            assertJsonDescribesObject(actual, expected);
            done();
        });
    });
    it("sessionRemove removes session", (done) => {
        var machineName = TEST_MACHINE_NAME;
        var command = {
            type: cli.CommandType.sessionRemove,
            machineName: machineName,
        };
        var removeSession = sandbox.spy(cmdexec.sdk, "removeSession");
        cmdexec.execute(command).done(() => {
            sinon.assert.calledOnce(removeSession);
            sinon.assert.calledWithExactly(removeSession, machineName);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, `Successfully removed the login session for "${machineName}".`);
            done();
        });
    });
    it("sessionRemove does not remove session if cancelled", (done) => {
        var machineName = TEST_MACHINE_NAME;
        var command = {
            type: cli.CommandType.sessionRemove,
            machineName: machineName,
        };
        var removeSession = sandbox.spy(cmdexec.sdk, "removeSession");
        wasConfirmed = false;
        cmdexec.execute(command).done(() => {
            sinon.assert.notCalled(removeSession);
            sinon.assert.calledOnce(log);
            sinon.assert.calledWithExactly(log, "Session removal cancelled.");
            done();
        });
    });
    it("sessionRemove does not remove current session", (done) => {
        var machineName = os.hostname();
        var command = {
            type: cli.CommandType.sessionRemove,
            machineName: machineName,
        };
        wasConfirmed = false;
        cmdexec
            .execute(command)
            .then(() => {
            done(new Error("Did not throw error."));
        })
            .catch(() => {
            done();
        })
            .done();
    });
    function releaseHelperFunction(command, done, expectedError) {
        cmdexec.execute(command).done(() => {
            throw "Error Expected";
        }, (error) => {
            assert(!!error);
            assert.equal(error.message, expectedError);
            done();
        });
    }
});
