// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * NOTE!!! This utility file is duplicated for use by the CodePush service (for server-driven hashing/
 * integrity checks) and CLI (for end-to-end code signing), please keep them in sync.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as q from "q";
import * as stream from "stream";

// Do not throw an exception if either of these modules are missing, as they may not be needed by the
// consumer of this file.
// - recursiveFs: Only required for hashing of directories
// - yauzl: Only required for in-memory hashing of zip files
let recursiveFs, yauzl;

try {
  recursiveFs = require("recursive-fs");
} catch (e) {}
try {
  yauzl = require("yauzl");
} catch (e) {}

import Promise = q.Promise;
const HASH_ALGORITHM = "sha256";

const CODEPUSH_METADATA = '.codepushrelease';

export function generatePackageHashFromDirectory(directoryPath: string, basePath: string): Promise<string> {
  if (!fs.lstatSync(directoryPath).isDirectory()) {
    throw new Error("Not a directory. Please either create a directory, or use hashFile().");
  }

  return generatePackageManifestFromDirectory(directoryPath, basePath).then((manifest: PackageManifest) => {
    return manifest.computePackageHash();
  });
}

export function generatePackageManifestFromZip(filePath: string): Promise<PackageManifest> {
  const deferred: q.Deferred<PackageManifest> = q.defer<PackageManifest>();
  const reject = (error: Error) => {
    if (deferred.promise.isPending()) {
      deferred.reject(error);
    }
  };

  const resolve = (manifest: PackageManifest) => {
    if (deferred.promise.isPending()) {
      deferred.resolve(manifest);
    }
  };

  let zipFile: any;

  yauzl.open(filePath, { lazyEntries: true }, (error?: any, openedZipFile?: any): void => {
    if (error) {
      // This is the first time we try to read the package as a .zip file;
      // however, it may not be a .zip file.  Handle this gracefully.
      resolve(null);
      return;
    }

    zipFile = openedZipFile;
    const fileHashesMap = new Map<string, string>();
    const hashFilePromises: q.Promise<void>[] = [];

    // Read each entry in the archive sequentially and generate a hash for it.
    zipFile.readEntry();
    zipFile
      .on("error", (error: any): void => {
        reject(error);
      })
      .on("entry", (entry: any): void => {
        const fileName: string = PackageManifest.normalizePath(entry.fileName);
        if (PackageManifest.isIgnored(fileName)) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (error?: any, readStream?: stream.Readable): void => {
          if (error) {
            reject(error);
            return;
          }

          hashFilePromises.push(
            hashStream(readStream).then((hash: string) => {
              fileHashesMap.set(fileName, hash);
              zipFile.readEntry();
            }, reject)
          );
        });
      })
      .on("end", (): void => {
        q.all(hashFilePromises).then(() => resolve(new PackageManifest(fileHashesMap)), reject);
      });
  });

  return deferred.promise.finally(() => zipFile && zipFile.close());
}

export function generatePackageManifestFromDirectory(directoryPath: string, basePath: string): Promise<PackageManifest> {
  const deferred: q.Deferred<PackageManifest> = q.defer<PackageManifest>();
  const fileHashesMap = new Map<string, string>();

  recursiveFs.readdirr(directoryPath, (error?: any, directories?: string[], files?: string[]): void => {
    if (error) {
      deferred.reject(error);
      return;
    }

    if (!files || files.length === 0) {
      deferred.reject("Error: Can't sign the release because no files were found.");
      return;
    }

    // Hash the files sequentially, because streaming them in parallel is not necessarily faster
    const generateManifestPromise: Promise<void> = files.reduce((soFar: Promise<void>, filePath: string) => {
      return soFar.then(() => {
        const relativePath: string = PackageManifest.normalizePath(path.relative(basePath, filePath));
        if (!PackageManifest.isIgnored(relativePath)) {
          return hashFile(filePath).then((hash: string) => {
            fileHashesMap.set(relativePath, hash);
          });
        }
      });
    }, q(<void>null));

    generateManifestPromise
      .then(() => {
        deferred.resolve(new PackageManifest(fileHashesMap));
      }, deferred.reject)
      .done();
  });

  return deferred.promise;
}

export function hashFile(filePath: string): Promise<string> {
  const readStream: fs.ReadStream = fs.createReadStream(filePath);
  return hashStream(readStream);
}

export function hashStream(readStream: stream.Readable): Promise<string> {
  const hashStream = <stream.Transform>(<any>crypto.createHash(HASH_ALGORITHM));
  const deferred: q.Deferred<string> = q.defer<string>();

  readStream
    .on("error", (error: any): void => {
      if (deferred.promise.isPending()) {
        hashStream.end();
        deferred.reject(error);
      }
    })
    .on("end", (): void => {
      if (deferred.promise.isPending()) {
        hashStream.end();

        const buffer = <Buffer>hashStream.read();
        const hash: string = buffer.toString("hex");

        deferred.resolve(hash);
      }
    });

  readStream.pipe(hashStream as any);

  return deferred.promise;
}

export class PackageManifest {
  private _map: Map<string, string>;

  public constructor(map?: Map<string, string>) {
    if (!map) {
      map = new Map<string, string>();
    }
    this._map = map;
  }

  public toMap(): Map<string, string> {
    return this._map;
  }

  public computePackageHash(): Promise<string> {
    let entries: string[] = [];
    this._map.forEach((hash: string, name: string): void => {
      // .codepushrelease (relates to code signing feature) file
      // should not be skipped in isIgnored() method.
      // But to be equal with hashes computed in SDKs and CLI this file
      // should be skipped when computing whole package hash

      if (name !== CODEPUSH_METADATA && !endsWith(name, '/' + CODEPUSH_METADATA)) {
        entries.push(name + ':' + hash);
      }
    });

    // Make sure this list is alphabetically ordered so that other clients
    // can also compute this hash easily given the update contents.
    entries = entries.sort();

    return q(crypto.createHash(HASH_ALGORITHM).update(JSON.stringify(entries)).digest("hex"));
  }

  public serialize(): string {
    const obj: any = {};

    this._map.forEach(function (value, key) {
      obj[key] = value;
    });

    return JSON.stringify(obj);
  }

  public static deserialize(serializedContents: string): PackageManifest {
    try {
      const obj: any = JSON.parse(serializedContents);
      const map = new Map<string, string>();

      for (const key of Object.keys(obj)) {
        map.set(key, obj[key]);
      }

      return new PackageManifest(map);
    } catch (e) {}
  }

  public static normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
  }

  public static isIgnored(relativeFilePath: string): boolean {
    const __MACOSX = "__MACOSX/";
    const DS_STORE = ".DS_Store";

    return startsWith(relativeFilePath, __MACOSX) || relativeFilePath === DS_STORE || endsWith(relativeFilePath, "/" + DS_STORE);
  }
}

function startsWith(str: string, prefix: string): boolean {
  return str && str.substring(0, prefix.length) === prefix;
}

function endsWith(str: string, suffix: string): boolean {
  return str && str.indexOf(suffix, str.length - suffix.length) !== -1;
}
