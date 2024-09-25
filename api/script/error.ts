// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum ErrorSource {
  Storage = 0,
  Rest = 1,
  Diffing = 2,
}

export interface CodePushError extends Error {
  source: ErrorSource;
}

export function codePushError(source: ErrorSource, message?: string): CodePushError {
  const error = <CodePushError>new Error(message);
  error.source = source;
  return error;
}
