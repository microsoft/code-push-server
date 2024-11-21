// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";
import * as querystring from "querystring";

import * as acquisitionSdk from "../script/acquisition-sdk";
import * as rest from "../script/types/rest-definitions";

export var validDeploymentKey = "asdfasdfawerqw";
export var latestPackage = <rest.UpdateCheckResponse>{
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

export var serverUrl = "http://myurl.com";
var reportStatusDeployUrl = serverUrl + "/reportStatus/deploy";
var reportStatusDownloadUrl = serverUrl + "/reportStatus/download";
var updateCheckUrl = serverUrl + "/updateCheck?";

export class HttpRequester implements acquisitionSdk.Http.Requester {
  public request(
    verb: acquisitionSdk.Http.Verb,
    url: string,
    requestBodyOrCallback: string | acquisitionSdk.Callback<acquisitionSdk.Http.Response>,
    callback?: acquisitionSdk.Callback<acquisitionSdk.Http.Response>,
  ): void {
    if (!callback && typeof requestBodyOrCallback === "function") {
      callback = <acquisitionSdk.Callback<acquisitionSdk.Http.Response>>requestBodyOrCallback;
    }

    if (verb === acquisitionSdk.Http.Verb.GET && url.indexOf(updateCheckUrl) === 0) {
      var params = querystring.parse(url.substring(updateCheckUrl.length));
      Server.onUpdateCheck(params, callback);
    } else if (verb === acquisitionSdk.Http.Verb.POST && url === reportStatusDeployUrl) {
      Server.onReportStatus(callback);
    } else if (verb === acquisitionSdk.Http.Verb.POST && url === reportStatusDownloadUrl) {
      Server.onReportStatus(callback);
    } else {
      throw new Error("Unexpected call");
    }
  }
}

export class CustomResponseHttpRequester implements acquisitionSdk.Http.Requester {
  response: acquisitionSdk.Http.Response;

  constructor(response: acquisitionSdk.Http.Response) {
    this.response = response;
  }

  public request(
    verb: acquisitionSdk.Http.Verb,
    url: string,
    requestBodyOrCallback: string | acquisitionSdk.Callback<acquisitionSdk.Http.Response>,
    callback?: acquisitionSdk.Callback<acquisitionSdk.Http.Response>,
  ): void {
    if (typeof requestBodyOrCallback !== "function") {
      throw new Error("Unexpected request body");
    }

    callback = <acquisitionSdk.Callback<acquisitionSdk.Http.Response>>requestBodyOrCallback;
    callback(null, this.response);
  }
}

class Server {
  public static onAcquire(params: any, callback: acquisitionSdk.Callback<acquisitionSdk.Http.Response>): void {
    if (params.deploymentKey !== validDeploymentKey) {
      callback(/*error=*/ null, {
        statusCode: 200,
        body: JSON.stringify({ updateInfo: { isAvailable: false } }),
      });
    } else {
      callback(/*error=*/ null, {
        statusCode: 200,
        body: JSON.stringify({ updateInfo: latestPackage }),
      });
    }
  }

  public static onUpdateCheck(params: any, callback: acquisitionSdk.Callback<acquisitionSdk.Http.Response>): void {
    var updateRequest: rest.UpdateCheckRequest = {
      deploymentKey: params.deploymentKey,
      appVersion: params.appVersion,
      packageHash: params.packageHash,
      isCompanion: !!params.isCompanion,
      label: params.label,
    };

    if (!updateRequest.deploymentKey || !updateRequest.appVersion) {
      callback(/*error=*/ null, { statusCode: 400 });
    } else {
      var updateInfo = <rest.UpdateCheckResponse>{ isAvailable: false };
      if (updateRequest.deploymentKey === validDeploymentKey) {
        if (updateRequest.isCompanion || updateRequest.appVersion === latestPackage.appVersion) {
          if (updateRequest.packageHash !== latestPackage.packageHash) {
            updateInfo = latestPackage;
          }
        } else if (updateRequest.appVersion < latestPackage.appVersion) {
          updateInfo = <rest.UpdateCheckResponse>(<any>{
            updateAppVersion: true,
            appVersion: latestPackage.appVersion,
          });
        }
      }

      callback(/*error=*/ null, {
        statusCode: 200,
        body: JSON.stringify({ updateInfo: updateInfo }),
      });
    }
  }

  public static onReportStatus(callback: acquisitionSdk.Callback<acquisitionSdk.Http.Response>): void {
    callback(/*error*/ null, /*response*/ { statusCode: 200 });
  }
}
