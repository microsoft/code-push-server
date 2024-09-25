// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";

export const API_VERSION = 2;
export const API_VERSION_HEADER = "X-CodePush-API-Version";
export const CLI_VERSION_HEADER = "X-CodePush-CLI-Version";
export const PLUGIN_NAME_HEADER = "X-CodePush-Plugin-Name";
export const PLUGIN_VERSION_HEADER = "X-CodePush-Plugin-Version";
export const SDK_VERSION_HEADER = "X-CodePush-SDK-Version";

export function getSdkVersion(req: express.Request): string {
  return req.get(SDK_VERSION_HEADER);
}

export function getCliVersion(req: express.Request): string {
  return req.get(CLI_VERSION_HEADER);
}

export function getPluginName(req: express.Request): string {
  return req.get(PLUGIN_NAME_HEADER);
}

export function getPluginVersion(req: express.Request): string {
  return req.get(PLUGIN_VERSION_HEADER);
}

export function getIpAddress(req: express.Request): string {
  const ipAddress: string =
    req.headers["x-client-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.headers["x-cluster-client-ip"] ||
    req.headers["x-forwarded"] ||
    req.headers["forwarded-for"] ||
    req.headers["forwarded"] ||
    (req.socket && req.socket.remoteAddress) ||
    ((<any>req).info && (<any>req).info.remoteAddress);

  return ipAddress
    ? // Some of the headers are set by proxies to a comma-separated list of IPs starting from the origin.
      ipAddress.split(",")[0]
    : "Unknown";
}
