import * as fs from "fs/promises";
import * as hashUtils from "./hash-utils";
import * as path from "path";
import * as jwt from "jsonwebtoken";
import { copyFileToTmpDir, isDirectory } from "./utils/file-utils";

const CURRENT_CLAIM_VERSION: string = "1.0.0";
const METADATA_FILE_NAME: string = ".codepushrelease";

interface CodeSigningClaims {
  claimVersion: string;
  contentHash: string;
}

export default async function sign(privateKeyPath: string, updateContentsPath: string): Promise<void> {
  if (!privateKeyPath) {
    return Promise.resolve<void>(null);
  }

  let privateKey: Buffer;

  try {
    privateKey = await fs.readFile(privateKeyPath);
  } catch (err) {
    return Promise.reject(new Error(`The path specified for the signing key ("${privateKeyPath}") was not valid.`));
  }

  // If releasing a single file, copy the file to a temporary 'CodePush' directory in which to publish the release
  try {
    if (!isDirectory(updateContentsPath)) {
      updateContentsPath = copyFileToTmpDir(updateContentsPath);
    }
  } catch (error) {
    Promise.reject(error);
  }

  const signatureFilePath: string = path.join(updateContentsPath, METADATA_FILE_NAME);
  let prevSignatureExists = true;
  try {
    await fs.access(signatureFilePath, fs.constants.F_OK);
  } catch (err) {
    if (err.code === "ENOENT") {
      prevSignatureExists = false;
    } else {
      return Promise.reject<void>(
        new Error(
          `Could not delete previous release signature at ${signatureFilePath}.
                Please, check your access rights.`
        )
      );
    }
  }

  if (prevSignatureExists) {
    console.log(`Deleting previous release signature at ${signatureFilePath}`);
    await fs.rmdir(signatureFilePath);
  }

  const hash: string = await hashUtils.generatePackageHashFromDirectory(updateContentsPath, path.join(updateContentsPath, ".."));
  const claims: CodeSigningClaims = {
    claimVersion: CURRENT_CLAIM_VERSION,
    contentHash: hash,
  };

  return new Promise<void>((resolve, reject) => {
    jwt.sign(claims, privateKey, { algorithm: "RS256" }, async (err: Error, signedJwt: string) => {
      if (err) {
        reject(new Error("The specified signing key file was not valid"));
      }

      try {
        await fs.writeFile(signatureFilePath, signedJwt);
        console.log(`Generated a release signature and wrote it to ${signatureFilePath}`);
        resolve(null);
      } catch (error) {
        reject(error);
      }
    });
  });
}
