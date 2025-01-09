"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs/promises");
const hashUtils = require("./hash-utils");
const path = require("path");
const jwt = require("jsonwebtoken");
const file_utils_1 = require("./utils/file-utils");
const CURRENT_CLAIM_VERSION = "1.0.0";
const METADATA_FILE_NAME = ".codepushrelease";
async function sign(privateKeyPath, updateContentsPath) {
    if (!privateKeyPath) {
        return Promise.resolve(null);
    }
    let privateKey;
    try {
        privateKey = await fs.readFile(privateKeyPath);
    }
    catch (err) {
        return Promise.reject(new Error(`The path specified for the signing key ("${privateKeyPath}") was not valid.`));
    }
    // If releasing a single file, copy the file to a temporary 'CodePush' directory in which to publish the release
    try {
        if (!(0, file_utils_1.isDirectory)(updateContentsPath)) {
            updateContentsPath = (0, file_utils_1.copyFileToTmpDir)(updateContentsPath);
        }
    }
    catch (error) {
        Promise.reject(error);
    }
    const signatureFilePath = path.join(updateContentsPath, METADATA_FILE_NAME);
    let prevSignatureExists = true;
    try {
        await fs.access(signatureFilePath, fs.constants.F_OK);
    }
    catch (err) {
        if (err.code === "ENOENT") {
            prevSignatureExists = false;
        }
        else {
            return Promise.reject(new Error(`Could not delete previous release signature at ${signatureFilePath}.
                Please, check your access rights.`));
        }
    }
    if (prevSignatureExists) {
        console.log(`Deleting previous release signature at ${signatureFilePath}`);
        await fs.rmdir(signatureFilePath);
    }
    const hash = await hashUtils.generatePackageHashFromDirectory(updateContentsPath, path.join(updateContentsPath, ".."));
    const claims = {
        claimVersion: CURRENT_CLAIM_VERSION,
        contentHash: hash,
    };
    return new Promise((resolve, reject) => {
        jwt.sign(claims, privateKey, { algorithm: "RS256" }, async (err, signedJwt) => {
            if (err) {
                reject(new Error("The specified signing key file was not valid"));
            }
            try {
                await fs.writeFile(signatureFilePath, signedJwt);
                console.log(`Generated a release signature and wrote it to ${signatureFilePath}`);
                resolve(null);
            }
            catch (error) {
                reject(error);
            }
        });
    });
}
exports.default = sign;
