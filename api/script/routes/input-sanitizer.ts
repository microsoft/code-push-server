// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";

export function InputSanitizer(req: express.Request, res: express.Response, next: (err?: any) => void): any {
  if (req.query) {
    req.query.deploymentKey = trimInvalidCharacters((req.query.deploymentKey || req.query.deployment_key) as string);
  }

  next();
}

function trimInvalidCharacters(text: string): string {
  return text && text.trim();
}
