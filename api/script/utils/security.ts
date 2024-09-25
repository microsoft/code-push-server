// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as crypto from "crypto";

export const ALLOWED_KEY_CHARACTERS_TEST: RegExp = /^[a-zA-Z0-9_-]+$/;

export function generateSecureKey(accountId: string): string {
  return crypto
    .randomBytes(21)
    .toString("base64")
    .replace(/\+/g, "_") // URL-friendly characters
    .replace(/\//g, "-")
    .replace(/^-/, "_") // no '-' in the beginning
    .concat(accountId);
}
