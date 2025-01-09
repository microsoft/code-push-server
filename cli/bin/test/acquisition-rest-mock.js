"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomResponseHttpRequester = exports.HttpRequester = exports.serverUrl = exports.latestPackage = exports.validDeploymentKey = void 0;
const querystring = require("querystring");
exports.validDeploymentKey = "asdfasdfawerqw";
exports.latestPackage = {
    downloadURL: "http://www.windowsazure.com/blobs/awperoiuqpweru",
    description: "Angry flappy birds",
    appVersion: "1.5.0",
    label: "2.4.0",
    isMandatory: false,
    isAvailable: true,
    updateAppVersion: false,
    packageHash: "hash240",
    packageSize: 1024,
};
exports.serverUrl = "http://myurl.com";
var reportStatusDeployUrl = exports.serverUrl + "/reportStatus/deploy";
var reportStatusDownloadUrl = exports.serverUrl + "/reportStatus/download";
var updateCheckUrl = exports.serverUrl + "/updateCheck?";
class HttpRequester {
    request(verb, url, requestBodyOrCallback, callback) {
        if (!callback && typeof requestBodyOrCallback === "function") {
            callback = requestBodyOrCallback;
        }
        if (verb === 0 /* acquisitionSdk.Http.Verb.GET */ && url.indexOf(updateCheckUrl) === 0) {
            var params = querystring.parse(url.substring(updateCheckUrl.length));
            Server.onUpdateCheck(params, callback);
        }
        else if (verb === 2 /* acquisitionSdk.Http.Verb.POST */ && url === reportStatusDeployUrl) {
            Server.onReportStatus(callback);
        }
        else if (verb === 2 /* acquisitionSdk.Http.Verb.POST */ && url === reportStatusDownloadUrl) {
            Server.onReportStatus(callback);
        }
        else {
            throw new Error("Unexpected call");
        }
    }
}
exports.HttpRequester = HttpRequester;
class CustomResponseHttpRequester {
    response;
    constructor(response) {
        this.response = response;
    }
    request(verb, url, requestBodyOrCallback, callback) {
        if (typeof requestBodyOrCallback !== "function") {
            throw new Error("Unexpected request body");
        }
        callback = requestBodyOrCallback;
        callback(null, this.response);
    }
}
exports.CustomResponseHttpRequester = CustomResponseHttpRequester;
class Server {
    static onAcquire(params, callback) {
        if (params.deploymentKey !== exports.validDeploymentKey) {
            callback(/*error=*/ null, {
                statusCode: 200,
                body: JSON.stringify({ updateInfo: { isAvailable: false } }),
            });
        }
        else {
            callback(/*error=*/ null, {
                statusCode: 200,
                body: JSON.stringify({ updateInfo: exports.latestPackage }),
            });
        }
    }
    static onUpdateCheck(params, callback) {
        var updateRequest = {
            deploymentKey: params.deploymentKey,
            appVersion: params.appVersion,
            packageHash: params.packageHash,
            isCompanion: !!params.isCompanion,
            label: params.label,
        };
        if (!updateRequest.deploymentKey || !updateRequest.appVersion) {
            callback(/*error=*/ null, { statusCode: 400 });
        }
        else {
            var updateInfo = { isAvailable: false };
            if (updateRequest.deploymentKey === exports.validDeploymentKey) {
                if (updateRequest.isCompanion || updateRequest.appVersion === exports.latestPackage.appVersion) {
                    if (updateRequest.packageHash !== exports.latestPackage.packageHash) {
                        updateInfo = exports.latestPackage;
                    }
                }
                else if (updateRequest.appVersion < exports.latestPackage.appVersion) {
                    updateInfo = {
                        updateAppVersion: true,
                        appVersion: exports.latestPackage.appVersion,
                    };
                }
            }
            callback(/*error=*/ null, {
                statusCode: 200,
                body: JSON.stringify({ updateInfo: updateInfo }),
            });
        }
    }
    static onReportStatus(callback) {
        callback(/*error*/ null, /*response*/ { statusCode: 200 });
    }
}
