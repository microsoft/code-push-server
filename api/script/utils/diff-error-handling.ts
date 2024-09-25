// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as errorModule from "../error";
import * as storageTypes from "../storage/storage";

export enum ErrorCode {
  InvalidArguments = 0,
  ConnectionFailed = 1,
  ProcessingFailed = 2,
  Other = 99,
}

export interface DiffError extends errorModule.CodePushError {
  code: ErrorCode;
}

export function diffError(errorCode: ErrorCode, message?: string): DiffError {
  const diffError = <DiffError>errorModule.codePushError(errorModule.ErrorSource.Diffing, message);
  diffError.code = errorCode;
  return diffError;
}

export function diffErrorHandler(error: any): any {
  if (error.source === errorModule.ErrorSource.Storage) {
    let handledError: DiffError;
    switch (error.code) {
      case storageTypes.ErrorCode.NotFound:
        handledError = diffError(ErrorCode.ProcessingFailed, "Unable to fetch data from storage, not found");
        break;

      case storageTypes.ErrorCode.ConnectionFailed:
        handledError = diffError(ErrorCode.ConnectionFailed, "Error retrieving data from storage, connection failed.");
        break;

      default:
        handledError = diffError(ErrorCode.Other, error.message || "Unknown error");
        break;
    }

    throw handledError;
  } else {
    throw error;
  }
}
