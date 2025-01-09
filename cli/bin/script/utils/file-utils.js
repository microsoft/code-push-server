"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePath = exports.fileDoesNotExistOrIsDirectory = exports.copyFileToTmpDir = exports.fileExists = exports.isDirectory = exports.isBinaryOrZip = void 0;
const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");
const temp = require("temp");
function isBinaryOrZip(path) {
    return path.search(/\.zip$/i) !== -1 || path.search(/\.apk$/i) !== -1 || path.search(/\.ipa$/i) !== -1;
}
exports.isBinaryOrZip = isBinaryOrZip;
function isDirectory(path) {
    return fs.statSync(path).isDirectory();
}
exports.isDirectory = isDirectory;
function fileExists(file) {
    try {
        return fs.statSync(file).isFile();
    }
    catch (e) {
        return false;
    }
}
exports.fileExists = fileExists;
;
function copyFileToTmpDir(filePath) {
    if (!isDirectory(filePath)) {
        const outputFolderPath = temp.mkdirSync("code-push");
        rimraf.sync(outputFolderPath);
        fs.mkdirSync(outputFolderPath);
        const outputFilePath = path.join(outputFolderPath, path.basename(filePath));
        fs.writeFileSync(outputFilePath, fs.readFileSync(filePath));
        return outputFolderPath;
    }
}
exports.copyFileToTmpDir = copyFileToTmpDir;
function fileDoesNotExistOrIsDirectory(path) {
    try {
        return isDirectory(path);
    }
    catch (error) {
        return true;
    }
}
exports.fileDoesNotExistOrIsDirectory = fileDoesNotExistOrIsDirectory;
function normalizePath(filePath) {
    //replace all backslashes coming from cli running on windows machines by slashes
    return filePath.replace(/\\/g, "/");
}
exports.normalizePath = normalizePath;
