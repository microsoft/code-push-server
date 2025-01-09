"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageManifest = exports.hashStream = exports.hashFile = exports.generatePackageManifestFromDirectory = exports.generatePackageManifestFromZip = exports.generatePackageHashFromDirectory = void 0;
/**
 * NOTE!!! This utility file is duplicated for use by the CodePush service (for server-driven hashing/
 * integrity checks) and Management SDK (for end-to-end code signing), please keep them in sync.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const q = require("q");
// Do not throw an exception if either of these modules are missing, as they may not be needed by the
// consumer of this file.
// - recursiveFs: Only required for hashing of directories
// - yauzl: Only required for in-memory hashing of zip files
let recursiveFs, yauzl;
try {
    recursiveFs = require("recursive-fs");
}
catch (e) { }
try {
    yauzl = require("yauzl");
}
catch (e) { }
const HASH_ALGORITHM = "sha256";
function generatePackageHashFromDirectory(directoryPath, basePath) {
    if (!fs.lstatSync(directoryPath).isDirectory()) {
        throw new Error("Not a directory. Please either create a directory, or use hashFile().");
    }
    return generatePackageManifestFromDirectory(directoryPath, basePath).then((manifest) => {
        return manifest.computePackageHash();
    });
}
exports.generatePackageHashFromDirectory = generatePackageHashFromDirectory;
function generatePackageManifestFromZip(filePath) {
    const deferred = q.defer();
    const reject = (error) => {
        if (deferred.promise.isPending()) {
            deferred.reject(error);
        }
    };
    const resolve = (manifest) => {
        if (deferred.promise.isPending()) {
            deferred.resolve(manifest);
        }
    };
    let zipFile;
    yauzl.open(filePath, { lazyEntries: true }, (error, openedZipFile) => {
        if (error) {
            // This is the first time we try to read the package as a .zip file;
            // however, it may not be a .zip file.  Handle this gracefully.
            resolve(null);
            return;
        }
        zipFile = openedZipFile;
        const fileHashesMap = new Map();
        const hashFilePromises = [];
        // Read each entry in the archive sequentially and generate a hash for it.
        zipFile.readEntry();
        zipFile
            .on("error", (error) => {
            reject(error);
        })
            .on("entry", (entry) => {
            const fileName = PackageManifest.normalizePath(entry.fileName);
            if (PackageManifest.isIgnored(fileName)) {
                zipFile.readEntry();
                return;
            }
            zipFile.openReadStream(entry, (error, readStream) => {
                if (error) {
                    reject(error);
                    return;
                }
                hashFilePromises.push(hashStream(readStream).then((hash) => {
                    fileHashesMap.set(fileName, hash);
                    zipFile.readEntry();
                }, reject));
            });
        })
            .on("end", () => {
            q.all(hashFilePromises).then(() => resolve(new PackageManifest(fileHashesMap)), reject);
        });
    });
    return deferred.promise.finally(() => zipFile && zipFile.close());
}
exports.generatePackageManifestFromZip = generatePackageManifestFromZip;
function generatePackageManifestFromDirectory(directoryPath, basePath) {
    const deferred = q.defer();
    const fileHashesMap = new Map();
    recursiveFs.readdirr(directoryPath, (error, directories, files) => {
        if (error) {
            deferred.reject(error);
            return;
        }
        if (!files || files.length === 0) {
            deferred.reject("Error: Can't sign the release because no files were found.");
            return;
        }
        // Hash the files sequentially, because streaming them in parallel is not necessarily faster
        const generateManifestPromise = files.reduce((soFar, filePath) => {
            return soFar.then(() => {
                const relativePath = PackageManifest.normalizePath(path.relative(basePath, filePath));
                if (!PackageManifest.isIgnored(relativePath)) {
                    return hashFile(filePath).then((hash) => {
                        fileHashesMap.set(relativePath, hash);
                    });
                }
            });
        }, q(null));
        generateManifestPromise
            .then(() => {
            deferred.resolve(new PackageManifest(fileHashesMap));
        }, deferred.reject)
            .done();
    });
    return deferred.promise;
}
exports.generatePackageManifestFromDirectory = generatePackageManifestFromDirectory;
function hashFile(filePath) {
    const readStream = fs.createReadStream(filePath);
    return hashStream(readStream);
}
exports.hashFile = hashFile;
function hashStream(readStream) {
    const hashStream = crypto.createHash(HASH_ALGORITHM);
    const deferred = q.defer();
    readStream
        .on("error", (error) => {
        if (deferred.promise.isPending()) {
            hashStream.end();
            deferred.reject(error);
        }
    })
        .on("end", () => {
        if (deferred.promise.isPending()) {
            hashStream.end();
            const buffer = hashStream.read();
            const hash = buffer.toString("hex");
            deferred.resolve(hash);
        }
    });
    readStream.pipe(hashStream);
    return deferred.promise;
}
exports.hashStream = hashStream;
class PackageManifest {
    _map;
    constructor(map) {
        if (!map) {
            map = new Map();
        }
        this._map = map;
    }
    toMap() {
        return this._map;
    }
    computePackageHash() {
        let entries = [];
        this._map.forEach((hash, name) => {
            entries.push(name + ":" + hash);
        });
        // Make sure this list is alphabetically ordered so that other clients
        // can also compute this hash easily given the update contents.
        entries = entries.sort();
        return q(crypto.createHash(HASH_ALGORITHM).update(JSON.stringify(entries)).digest("hex"));
    }
    serialize() {
        const obj = {};
        this._map.forEach(function (value, key) {
            obj[key] = value;
        });
        return JSON.stringify(obj);
    }
    static deserialize(serializedContents) {
        try {
            const obj = JSON.parse(serializedContents);
            const map = new Map();
            for (const key of Object.keys(obj)) {
                map.set(key, obj[key]);
            }
            return new PackageManifest(map);
        }
        catch (e) { }
    }
    static normalizePath(filePath) {
        return filePath.replace(/\\/g, "/");
    }
    static isIgnored(relativeFilePath) {
        const __MACOSX = "__MACOSX/";
        const DS_STORE = ".DS_Store";
        return startsWith(relativeFilePath, __MACOSX) || relativeFilePath === DS_STORE || endsWith(relativeFilePath, "/" + DS_STORE);
    }
}
exports.PackageManifest = PackageManifest;
function startsWith(str, prefix) {
    return str && str.substring(0, prefix.length) === prefix;
}
function endsWith(str, suffix) {
    return str && str.indexOf(suffix, str.length - suffix.length) !== -1;
}
