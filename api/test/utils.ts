// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { Promise } from "q";
import * as shortid from "shortid";
import * as stream from "stream";

import * as storage from "../script/storage/storage";
import * as restTypes from "../script/types/rest-definitions";

const ACCESS_KEY_EXPIRY = 1000 * 60 * 60 * 24 * 60; // 60 days.

export interface FileProps {
  stream: fs.ReadStream;
  size: number;
}

export function generateKey(): string {
  return shortid.generate() + shortid.generate(); // The REST API validates that keys must be at least 10 characters long
}

export function makeAccount(): storage.Account {
  var account: storage.Account = {
    createdTime: new Date().getTime(),
    name: "test account",
    email: "test_" + shortid.generate() + "@email.com",
  };

  return account;
}

export function makeStorageAccessKey(): storage.AccessKey {
  var now: number = new Date().getTime();
  var friendlyName: string = shortid.generate();
  var accessKey: storage.AccessKey = {
    name: generateKey(),
    createdTime: now,
    createdBy: "test machine",
    friendlyName: friendlyName,
    description: friendlyName,
    expires: now + ACCESS_KEY_EXPIRY,
  };

  return accessKey;
}

export function makeAccessKeyRequest(): restTypes.AccessKeyRequest {
  var accessKeyRequest: restTypes.AccessKeyRequest = {
    name: generateKey(),
    createdBy: "test machine",
    friendlyName: shortid.generate(),
    ttl: ACCESS_KEY_EXPIRY,
  };

  return accessKeyRequest;
}

export function makeStorageApp(): storage.App {
  var app: storage.App = {
    createdTime: new Date().getDate(),
    name: shortid.generate(),
  };

  return app;
}

export function makeRestApp(): restTypes.App {
  var app: restTypes.App = {
    name: shortid.generate(),
    deployments: ["Production", "Staging"],
  };

  return app;
}

export function makeStorageDeployment(): storage.Deployment {
  var deployment: storage.Deployment = {
    createdTime: new Date().getDate(),
    name: shortid.generate(),
    key: generateKey(),
  };

  return deployment;
}

export function makeRestDeployment(): restTypes.Deployment {
  var deployment: restTypes.Deployment = {
    name: shortid.generate(),
  };

  return deployment;
}

export function makePackage(version?: string, isMandatory?: boolean, packageHash?: string, label?: string): storage.Package {
  var storagePackage: storage.Package = {
    blobUrl: "testUrl.com",
    description: "test blob id",
    isDisabled: false,
    isMandatory: isMandatory || false,
    rollout: null,
    appVersion: version || "test blob id",
    label: label || null,
    packageHash: packageHash || "hash123_n",
    size: 1,
    manifestBlobUrl: "test manifest blob URL",
    uploadTime: new Date().getTime(),
  };

  return storagePackage;
}

export function makeStreamFromString(stringValue: string): stream.Readable {
  var blobStream = new stream.Readable();
  blobStream.push(stringValue);
  blobStream.push(null);
  return blobStream;
}

export function makeStringFromStream(stream: stream.Readable): Promise<string> {
  var stringValue = "";
  return Promise((resolve: (stringValue: string) => void) => {
    stream
      .on("data", (data: string) => {
        stringValue += data;
      })
      .on("end", () => {
        resolve(stringValue);
      });
  });
}

export function getStreamAndSizeForFile(path: string): Promise<FileProps> {
  return Promise((resolve: (props: FileProps) => void, reject: (reason: any) => void) => {
    fs.stat(path, (err: NodeJS.ErrnoException, stats: fs.Stats): void => {
      if (err) {
        reject(err);
        return;
      }

      var readable: fs.ReadStream = fs.createReadStream(path);
      resolve({ stream: readable, size: stats.size });
    });
  });
}

export function retrieveStringContentsFromUrl(url: string): Promise<string> {
  var protocol: typeof http | typeof https = null;
  if (url.indexOf("https://") === 0) {
    protocol = https;
  } else {
    protocol = http;
  }

  return Promise((resolve: (stringValue: string) => void) => {
    const requestOptions: https.RequestOptions = {
      path: url,
    };
    protocol
      .get(requestOptions, (response: http.IncomingMessage) => {
        if (response.statusCode !== 200) {
          return null;
        }

        makeStringFromStream(response).then((contents: string) => {
          resolve(contents);
        });
      })
      .on("error", (error: any) => {
        resolve(null);
      });
  });
}
