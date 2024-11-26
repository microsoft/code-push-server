// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Router, RequestHandler } from "express";

import { getHeadersMiddleware, HeadersConfig } from "./routes/headers";
import { getAcquisitionRouter, getHealthRouter, AcquisitionConfig } from "./routes/acquisition";
import { getManagementRouter, ManagementConfig } from "./routes/management";
import { PassportAuthentication, AuthenticationConfig } from "./routes/passport-authentication";
import { Authentication } from "./routes/authentication";
import { AppInsights } from "./routes/app-insights";
import { InputSanitizer } from "./routes/input-sanitizer";
import { RequestTimeoutHandler } from "./routes/request-timeout";

export function headers(config: HeadersConfig): RequestHandler {
  return getHeadersMiddleware(config);
}

export function acquisition(config: AcquisitionConfig): Router {
  return getAcquisitionRouter(config);
}

export function health(config: AcquisitionConfig): Router {
  return getHealthRouter(config);
}

export function management(config: ManagementConfig): Router {
  return getManagementRouter(config);
}

export function auth(config: AuthenticationConfig): any {
  const passportAuthentication = new PassportAuthentication(config);
  const authentication = new Authentication(config);
  return {
    router: authentication.getRouter.bind(authentication),
    authenticate: authentication.authenticate.bind(authentication),
  };
}

export function appInsights(): any {
  const appInsights = new AppInsights();

  return {
    router: appInsights.getRouter.bind(appInsights),
    errorHandler: appInsights.errorHandler.bind(appInsights),
  };
}

export function inputSanitizer(): any {
  return InputSanitizer;
}

export function requestTimeoutHandler(): RequestHandler {
  return RequestTimeoutHandler;
}
