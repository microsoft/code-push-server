// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JsonStorage } from "../script/storage/json-storage";
import * as assert from "assert";
import * as express from "express";
import * as fs from "fs";
import * as hashUtils from "../script/utils/hash-utils";
import * as http from "http";
import * as packageDiffing from "../script/utils/package-diffing";
import * as path from "path";
import * as shortid from "shortid";
import * as storage from "../script/storage/storage";
import * as stream from "stream";
import * as utils from "./utils";
import * as yauzl from "yauzl";
import PackageDiffer = packageDiffing.PackageDiffer;
import PackageManifest = hashUtils.PackageManifest;
import Pend = require("pend");

describe("Package diffing with JSON storage", () => packageDiffTests(JsonStorage));

interface PackageInfo {
  packageHash: string;
  blobUrl: string;
  manifestBlobUrl: string;
}

function packageDiffTests(StorageType: new (...args: any[]) => storage.Storage): void {
  const TEST_ARCHIVE_FILE_NAMES = ["test.zip", "test2.zip", "test3.zip", "test4.zip"];
  const TEST_ARCHIVE_FILE_PATH = path.join(__dirname, "resources", TEST_ARCHIVE_FILE_NAMES[0]);
  const TEST_ARCHIVE_WITH_FOLDERS_FILE_PATH = path.join(__dirname, "resources", "testdirectories.zip");

  const TEST_ZIP_HASH = "540fed8df3553079e81d1353c5cc4e3cac7db9aea647a85d550f646e8620c317";
  const TEST_ZIP_MANIFEST_HASH = "9e0499ce7df5c04cb304c9deed684dc137fc603cb484a5b027478143c595d80b";
  const HASH_A = "418dd73df63bfe1dc9b1d126d340ccf4941198ccf573eff190a6ff8dc69e87e4";
  const HASH_B = "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d";
  const HASH_C = "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6";
  const HASH_D = "18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4";
  const MANIFEST_HASH = "9a5b5530de83276462aba1f936a7d341629dddfa86705cf4b8e84365bd828c08";
  const FOLDER_A_HASH = "c8e61e0c7e666745a4066a42ef37fca0ca519a52f695201bd387fbcb4e019cb2";
  const FOLDER_B_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const HOT_CODE_PUSH_JSON_HASH = "3a2de62a9c2b64b3ac2ccdfd113a0c758e5acb66882fdf270e3f36ecc417a96d";

  var storage: storage.Storage;
  var packageDiffingUtils: PackageDiffer;

  // Spin up a server to serve the blob.
  var server: http.Server;
  before(() => {
    storage = new StorageType();
    packageDiffingUtils = new PackageDiffer(storage, /*maxPackagesToDiff*/ 5);
    var app = express();
    app.use("/", express.static(path.join(__dirname, "resources")));
    var port = 3000;

    server = app.listen(port);
  });

  // Kill the server.
  after(() => {
    server.close();
  });

  describe("Package diffing utility (general)", () => {
    it("generates an incremental update package", (done) => {
      var oldManifest = new PackageManifest(
        new Map<string, string>()
          .set("a.txt", HASH_A) // This file is removed in the new manifest.  The diff's hotcodepush.json file will reference this file.
          .set("b.txt", HASH_B) // This file is unchanged in the new manifest and will not be present in the diff.
          .set("c.txt", "previoushash"),
      ); // This file will change in the new manifest.  The diff will contain the newer version of this file.
      var newManifest = new PackageManifest(new Map<string, string>().set("b.txt", HASH_B).set("c.txt", HASH_C).set("d.txt", HASH_D)); // This file is new as of the new manifest.  The diff will contain this file.
      var expectedDiffContents = new Map<string, string>()
        .set("c.txt", HASH_C)
        .set("d.txt", HASH_D)
        .set("hotcodepush.json", MANIFEST_HASH);

      packageDiffingUtils
        .generateDiffArchive(oldManifest, newManifest, TEST_ARCHIVE_FILE_PATH)
        .then((diffArchiveFilePath: string): void => {
          fs.exists(diffArchiveFilePath, (exists: boolean) => {
            assert.ok(exists);

            // Now verify that the diff package contents are correct.
            yauzl.open(diffArchiveFilePath, (error?: any, zipFile?: yauzl.ZipFile): void => {
              if (error) {
                throw error;
              }

              var pend = new Pend();

              zipFile
                .on("error", (error: any): void => {
                  throw error;
                })
                .on("entry", (entry: yauzl.IEntry): void => {
                  zipFile.openReadStream(entry, (error?: any, readStream?: stream.Readable): void => {
                    if (error) {
                      throw error;
                    }

                    pend.go((callback: (error?: any) => void): void => {
                      hashUtils
                        .hashStream(readStream)
                        .then((actualHash: string) => {
                          var expectedHash: string = expectedDiffContents.get(entry.fileName);
                          var error: Error;

                          if (actualHash !== expectedHash) {
                            error = new Error(
                              'The hash did not match for file "' +
                                entry.fileName +
                                '".  Expected hash:  ' +
                                expectedHash +
                                ".  Actual hash:  " +
                                actualHash +
                                ".",
                            );
                          }

                          expectedDiffContents.delete(entry.fileName);

                          callback(error);
                        }, callback)
                        .done();
                    });
                  });
                })
                .on("close", (): void => {
                  pend.wait((error?: any): void => {
                    if (error) {
                      throw error;
                    }

                    if (expectedDiffContents.size !== 0) {
                      throw new Error("The diff archive contents were incorrect.");
                    }

                    fs.unlinkSync(diffArchiveFilePath);

                    done();
                  });
                });
            });
          });
        });
    });

    it("generates an incremental update package with new folders", (done) => {
      var oldManifest = new PackageManifest(new Map<string, string>().set("www/folderA/", FOLDER_A_HASH));
      var newManifest = new PackageManifest(
        new Map<string, string>().set("www/folderA/", FOLDER_A_HASH).set("www/folderB/", FOLDER_B_HASH),
      ); // This folder is a new folder that did not appear in the previous package manifest;
      var expectedDiffContents = new Map<string, string>()
        .set("www/folderB/", FOLDER_B_HASH)
        .set("hotcodepush.json", HOT_CODE_PUSH_JSON_HASH);

      packageDiffingUtils
        .generateDiffArchive(oldManifest, newManifest, TEST_ARCHIVE_WITH_FOLDERS_FILE_PATH)
        .then((diffArchiveFilePath: string): void => {
          fs.exists(diffArchiveFilePath, (exists: boolean) => {
            assert.ok(exists);

            // Now verify that the diff package contents are correct.
            yauzl.open(diffArchiveFilePath, (error?: any, zipFile?: yauzl.ZipFile): void => {
              if (error) {
                throw error;
              }

              var pend = new Pend();

              zipFile
                .on("error", (error: any): void => {
                  throw error;
                })
                .on("entry", (entry: yauzl.IEntry): void => {
                  zipFile.openReadStream(entry, (error?: any, readStream?: stream.Readable): void => {
                    if (error) {
                      throw error;
                    }

                    pend.go((callback: (error?: any) => void): void => {
                      hashUtils
                        .hashStream(readStream)
                        .then((actualHash: string) => {
                          var expectedHash: string = expectedDiffContents.get(entry.fileName);
                          var error: Error;

                          if (actualHash !== expectedHash) {
                            error = new Error(
                              'The hash did not not match for file "' +
                                entry.fileName +
                                '".  Expected hash:  ' +
                                expectedHash +
                                ".  Actual hash:  " +
                                actualHash +
                                ".",
                            );
                          }

                          expectedDiffContents.delete(entry.fileName);

                          callback(error);
                        }, callback)
                        .done();
                    });
                  });
                })
                .on("close", (): void => {
                  pend.wait((error?: any): void => {
                    if (error) {
                      throw error;
                    }

                    if (expectedDiffContents.size !== 0) {
                      throw new Error("The diff archive contents were incorrect.");
                    }

                    fs.unlinkSync(diffArchiveFilePath);

                    done();
                  });
                });
            });
          });
        });
    });
  });

  function uploadAndGetPackageInfo(filePath: string): Promise<PackageInfo> {
    var info: PackageInfo = { packageHash: null, blobUrl: null, manifestBlobUrl: null };
    var manifest: PackageManifest;
    // @ts-ignore
    return hashUtils
      .generatePackageManifestFromZip(filePath)
      .then((retrievedManifest: PackageManifest) => {
        manifest = retrievedManifest;
        return manifest.computePackageHash();
      })
      .then((packageHash: string) => {
        info.packageHash = packageHash;
        var json: string = manifest.serialize();
        return storage.addBlob(shortid.generate(), utils.makeStreamFromString(json), json.length);
      })
      .then((blobId: string) => {
        return storage.getBlobUrl(blobId);
      })
      .then((savedManifestBlobUrl: string) => {
        info.manifestBlobUrl = savedManifestBlobUrl;
        return utils.getStreamAndSizeForFile(filePath);
      })
      .then((props: utils.FileProps) => {
        return storage.addBlob(shortid.generate(), props.stream, props.size);
      })
      .then((blobId: string) => {
        return storage.getBlobUrl(blobId);
      })
      .then((savedBlobUrl: string) => {
        info.blobUrl = savedBlobUrl;
        return info;
      });
  }

  function failOnCallSucceeded(result: any): any {
    throw new Error("Expected the promise to be rejected, but it succeeded with value " + (result ? JSON.stringify(result) : result));
  }
}
