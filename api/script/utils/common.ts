// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const streamToArray = require("stream-to-array");
const crypto = require("crypto");

import { Readable } from "stream";

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

export function convertObjectToSnakeCase(obj: any): any {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item: any) => convertObjectToSnakeCase(item));
  }

  return Object.keys(obj).reduce((acc, key) => {
    const snakeCaseKey: string = toSnakeCase(key);
    acc[snakeCaseKey] = convertObjectToSnakeCase(obj[key]);
    return acc;
  }, {} as any);
}

export async function streamToBuffer(readableStream: Readable): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    streamToArray(readableStream, (err: Error | null, arr: Array<Buffer | Uint8Array>) => {
      if (err) {
        reject(err);
      } else {
        const buffers = arr.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        const concatenatedBuffer = Buffer.concat(buffers);
        resolve(concatenatedBuffer.buffer);
      }
    });
  });
}

export function hashWithSHA256(input: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(input);
  return hash.digest("hex");
}
