// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getTempDirectory(): string {
  return process.env.PACKAGE_DIFFER_WORK_DIR || process.env.TEMP || process.env.TMPDIR || "/tmp";
}
