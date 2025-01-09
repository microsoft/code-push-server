"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcquisitionManager = exports.AcquisitionStatus = void 0;
class AcquisitionStatus {
    static DeploymentSucceeded = "DeploymentSucceeded";
    static DeploymentFailed = "DeploymentFailed";
}
exports.AcquisitionStatus = AcquisitionStatus;
class AcquisitionManager {
    _appVersion;
    _clientUniqueId;
    _deploymentKey;
    _httpRequester;
    _ignoreAppVersion;
    _serverUrl;
    constructor(httpRequester, configuration) {
        this._httpRequester = httpRequester;
        this._serverUrl = configuration.serverUrl;
        if (this._serverUrl.slice(-1) !== "/") {
            this._serverUrl += "/";
        }
        this._appVersion = configuration.appVersion;
        this._clientUniqueId = configuration.clientUniqueId;
        this._deploymentKey = configuration.deploymentKey;
        this._ignoreAppVersion = configuration.ignoreAppVersion;
    }
    queryUpdateWithCurrentPackage(currentPackage, callback) {
        if (!currentPackage || !currentPackage.appVersion) {
            throw new Error("Calling common acquisition SDK with incorrect package"); // Unexpected; indicates error in our implementation
        }
        const updateRequest = {
            deploymentKey: this._deploymentKey,
            appVersion: currentPackage.appVersion,
            packageHash: currentPackage.packageHash,
            isCompanion: this._ignoreAppVersion,
            label: currentPackage.label,
            clientUniqueId: this._clientUniqueId,
        };
        const requestUrl = this._serverUrl + "updateCheck?" + queryStringify(updateRequest);
        this._httpRequester.request(0 /* Http.Verb.GET */, requestUrl, (error, response) => {
            if (error) {
                callback(error, /*remotePackage=*/ null);
                return;
            }
            if (response.statusCode !== 200) {
                callback(new Error(response.statusCode + ": " + response.body), /*remotePackage=*/ null);
                return;
            }
            let updateInfo;
            try {
                const responseObject = JSON.parse(response.body);
                updateInfo = responseObject.updateInfo;
            }
            catch (error) {
                callback(error, /*remotePackage=*/ null);
                return;
            }
            if (!updateInfo) {
                callback(error, /*remotePackage=*/ null);
                return;
            }
            else if (updateInfo.updateAppVersion) {
                callback(/*error=*/ null, {
                    updateAppVersion: true,
                    appVersion: updateInfo.appVersion,
                });
                return;
            }
            else if (!updateInfo.isAvailable) {
                callback(/*error=*/ null, /*remotePackage=*/ null);
                return;
            }
            const remotePackage = {
                deploymentKey: this._deploymentKey,
                description: updateInfo.description,
                label: updateInfo.label,
                appVersion: updateInfo.appVersion,
                isMandatory: updateInfo.isMandatory,
                packageHash: updateInfo.packageHash,
                packageSize: updateInfo.packageSize,
                downloadUrl: updateInfo.downloadURL,
            };
            callback(/*error=*/ null, remotePackage);
        });
    }
    reportStatusDeploy(deployedPackage, status, previousLabelOrAppVersion, previousDeploymentKey, callback) {
        const url = this._serverUrl + "reportStatus/deploy";
        const body = {
            appVersion: this._appVersion,
            deploymentKey: this._deploymentKey,
        };
        if (this._clientUniqueId) {
            body.clientUniqueId = this._clientUniqueId;
        }
        if (deployedPackage) {
            body.label = deployedPackage.label;
            body.appVersion = deployedPackage.appVersion;
            switch (status) {
                case AcquisitionStatus.DeploymentSucceeded:
                case AcquisitionStatus.DeploymentFailed:
                    body.status = status;
                    break;
                default:
                    if (callback) {
                        if (!status) {
                            callback(new Error("Missing status argument."), /*not used*/ null);
                        }
                        else {
                            callback(new Error('Unrecognized status "' + status + '".'), /*not used*/ null);
                        }
                    }
                    return;
            }
        }
        if (previousLabelOrAppVersion) {
            body.previousLabelOrAppVersion = previousLabelOrAppVersion;
        }
        if (previousDeploymentKey) {
            body.previousDeploymentKey = previousDeploymentKey;
        }
        callback = typeof arguments[arguments.length - 1] === "function" && arguments[arguments.length - 1];
        this._httpRequester.request(2 /* Http.Verb.POST */, url, JSON.stringify(body), (error, response) => {
            if (callback) {
                if (error) {
                    callback(error, /*not used*/ null);
                    return;
                }
                if (response.statusCode !== 200) {
                    callback(new Error(response.statusCode + ": " + response.body), /*not used*/ null);
                    return;
                }
                callback(/*error*/ null, /*not used*/ null);
            }
        });
    }
    reportStatusDownload(downloadedPackage, callback) {
        const url = this._serverUrl + "reportStatus/download";
        const body = {
            clientUniqueId: this._clientUniqueId,
            deploymentKey: this._deploymentKey,
            label: downloadedPackage.label,
        };
        this._httpRequester.request(2 /* Http.Verb.POST */, url, JSON.stringify(body), (error, response) => {
            if (callback) {
                if (error) {
                    callback(error, /*not used*/ null);
                    return;
                }
                if (response.statusCode !== 200) {
                    callback(new Error(response.statusCode + ": " + response.body), /*not used*/ null);
                    return;
                }
                callback(/*error*/ null, /*not used*/ null);
            }
        });
    }
}
exports.AcquisitionManager = AcquisitionManager;
function queryStringify(object) {
    let queryString = "";
    let isFirst = true;
    for (const property in object) {
        if (object.hasOwnProperty(property)) {
            const value = object[property];
            if (!isFirst) {
                queryString += "&";
            }
            queryString += encodeURIComponent(property) + "=";
            if (value !== null && typeof value !== "undefined") {
                queryString += encodeURIComponent(value);
            }
            isFirst = false;
        }
    }
    return queryString;
}
