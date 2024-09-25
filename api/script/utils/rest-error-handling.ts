// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";

import * as errorModule from "../error";
import * as storageTypes from "../storage/storage";
import * as passportAuthentication from "../routes/passport-authentication";
import { AppInsights } from "../routes/app-insights";

const sanitizeHtml = require("sanitize-html");

export enum ErrorCode {
  Conflict = 0,
  MalformedRequest = 1,
  NotFound = 2,
  Unauthorized = 4,
  Other = 99,
}

export interface RestError extends errorModule.CodePushError {
  code: ErrorCode;
}

export function restError(errorCode: ErrorCode, message?: string): RestError {
  const restError = <RestError>errorModule.codePushError(errorModule.ErrorSource.Rest, message);
  restError.code = errorCode;
  return restError;
}

export function restErrorHandler(res: express.Response, error: errorModule.CodePushError, next: Function): void {
  if (!error || (error.source !== errorModule.ErrorSource.Storage && error.source !== errorModule.ErrorSource.Rest)) {
    console.log("Unknown error source");
    sendUnknownError(res, error, next);
  } else if (error.source === errorModule.ErrorSource.Storage) {
    storageErrorHandler(res, <storageTypes.StorageError>error, next);
  } else {
    const restError: RestError = <RestError>error;
    switch (restError.code) {
      case ErrorCode.Conflict:
        sendConflictError(res, error.message);
        break;
      case ErrorCode.MalformedRequest:
        sendMalformedRequestError(res, error.message);
        break;
      case ErrorCode.NotFound:
        sendNotFoundError(res, error.message);
        break;
      case ErrorCode.Unauthorized:
        sendForbiddenError(res, error.message);
        break;
      default:
        console.log("Unknown REST error");
        sendUnknownError(res, error, next);
        break;
    }
  }
}

export function sendMalformedRequestError(res: express.Response, message: string): void {
  if (message) {
    res.status(400).send(sanitizeHtml(message));
  } else {
    res.sendStatus(400);
  }
}

export function sendForbiddenError(res: express.Response, message?: string): void {
  if (message) {
    res.status(403).send(sanitizeHtml(message));
  } else {
    res.sendStatus(403);
  }
}

export function sendForbiddenPage(res: express.Response, message: string): void {
  res.status(403).render("message", { message: message });
}

export function sendNotFoundError(res: express.Response, message?: string): void {
  if (message) {
    res.status(404).send(sanitizeHtml(message));
  } else {
    res.sendStatus(404);
  }
}

export function sendNotRegisteredError(res: express.Response): void {
  if (passportAuthentication.PassportAuthentication.isAccountRegistrationEnabled()) {
    res.status(403).render("message", {
      message:
        "Account not found.<br/>Have you registered with the CLI?<br/>If you are registered but your email address has changed, please contact us.",
    });
  } else {
    res.status(403).render("message", {
      message:
        "Account not found.<br/>Please <a href='http://microsoft.github.io/code-push/'>sign up for the beta</a>, and we will contact you when your account has been created!</a>",
    });
  }
}

export function sendConflictError(res: express.Response, message?: string): void {
  message = message ? sanitizeHtml(message) : "The provided resource already exists";
  res.status(409).send(message);
}

export function sendAlreadyExistsPage(res: express.Response, message: string): void {
  res.status(409).render("message", { message: message });
}

export function sendResourceGoneError(res: express.Response, message: string): void {
  res.status(410).send(sanitizeHtml(message));
}

export function sendResourceGonePage(res: express.Response, message: string): void {
  res.status(410).render("message", { message: message });
}

export function sendTooLargeError(res: express.Response): void {
  res.status(413).send("The provided resource is too large");
}

export function sendConnectionFailedError(res: express.Response): void {
  res.status(503).send("The CodePush server temporarily timed out. Please try again.");
}

export function sendUnknownError(res: express.Response, error: any, next: Function): void {
  error = error || new Error("Unknown error");

  if (typeof error["stack"] === "string") {
    console.log(error["stack"]);
  } else {
    console.log(error);
  }

  if (AppInsights.isAppInsightsInstrumented()) {
    next(error); // Log error with AppInsights.
  } else {
    res.sendStatus(500);
  }
}

function storageErrorHandler(res: express.Response, error: storageTypes.StorageError, next: Function): void {
  switch (error.code) {
    case storageTypes.ErrorCode.NotFound:
      sendNotFoundError(res, error.message);
      break;
    case storageTypes.ErrorCode.AlreadyExists:
      sendConflictError(res, error.message);
      break;
    case storageTypes.ErrorCode.TooLarge:
      sendTooLargeError(res);
      break;
    case storageTypes.ErrorCode.ConnectionFailed:
      sendConnectionFailedError(res);
      break;
    case storageTypes.ErrorCode.Invalid:
      sendMalformedRequestError(res, error.message);
      break;
    case storageTypes.ErrorCode.Other:
    default:
      console.log("Unknown storage error.");
      sendUnknownError(res, error, next);
      break;
  }
}
