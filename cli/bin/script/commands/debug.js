"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const childProcess = require("child_process");
const moment = require("moment");
const path = require("path");
const Q = require("q");
const simctl = require("simctl");
const which = require("which");
class AndroidDebugPlatform {
    getLogProcess() {
        try {
            which.sync("adb");
        }
        catch (e) {
            throw new Error("ADB command not found. Please ensure it is installed and available on your path.");
        }
        const numberOfAvailableDevices = this.getNumberOfAvailableDevices();
        if (numberOfAvailableDevices === 0) {
            throw new Error("No Android devices found. Re-run this command after starting one.");
        }
        // For now there is no ability to specify device for debug like:
        // code-push debug android "192.168.121.102:5555"
        // So we have to throw an error in case more than 1 android device was attached
        // otherwise we will very likely run into an exception while trying to read ‘adb logcat’ from device which codepushified app is not running on.
        if (numberOfAvailableDevices > 1) {
            throw new Error(`Found "${numberOfAvailableDevices}" android devices. Please leave only one device you need to debug.`);
        }
        return childProcess.spawn("adb", ["logcat"]);
    }
    // The following is an example of what the output looks
    // like when running the "adb devices" command.
    //
    // List of devices attached
    // emulator-5554    device
    // 192.168.121.102:5555    device
    getNumberOfAvailableDevices() {
        const output = childProcess.execSync("adb devices").toString();
        const matches = output.match(/\b(device)\b/gim);
        if (matches != null) {
            return matches.length;
        }
        return 0;
    }
    normalizeLogMessage(message) {
        // Check to see whether the message includes the source URL
        // suffix, and if so, strip it. This can occur in Android Cordova apps.
        const sourceURLIndex = message.indexOf('", source: file:///');
        if (~sourceURLIndex) {
            return message.substring(0, sourceURLIndex);
        }
        else {
            return message;
        }
    }
}
class iOSDebugPlatform {
    getSimulatorID() {
        const output = simctl.list({ devices: true, silent: true });
        const simulators = output.json.devices
            .map((platform) => platform.devices)
            .reduce((prev, next) => prev.concat(next))
            .filter((device) => device.state === "Booted")
            .map((device) => device.id);
        return simulators[0];
    }
    getLogProcess() {
        if (process.platform !== "darwin") {
            throw new Error("iOS debug logs can only be viewed on OS X.");
        }
        const simulatorID = this.getSimulatorID();
        if (!simulatorID) {
            throw new Error("No iOS simulators found. Re-run this command after starting one.");
        }
        const logFilePath = path.join(process.env.HOME, "Library/Logs/CoreSimulator", simulatorID, "system.log");
        return childProcess.spawn("tail", ["-f", logFilePath]);
    }
    normalizeLogMessage(message) {
        return message;
    }
}
const logMessagePrefix = "[CodePush] ";
function processLogData(logData) {
    const content = logData.toString();
    content
        .split("\n")
        .filter((line) => line.indexOf(logMessagePrefix) > -1)
        .map((line) => {
        // Allow the current platform
        // to normalize the message first.
        line = this.normalizeLogMessage(line);
        // Strip the CodePush-specific, platform agnostic
        // log message prefix that is added to each entry.
        const message = line.substring(line.indexOf(logMessagePrefix) + logMessagePrefix.length);
        const timeStamp = moment().format("hh:mm:ss");
        return `[${timeStamp}] ${message}`;
    })
        .forEach((line) => console.log(line));
}
const debugPlatforms = {
    android: new AndroidDebugPlatform(),
    ios: new iOSDebugPlatform(),
};
function default_1(command) {
    return Q.Promise((resolve, reject) => {
        const platform = command.platform.toLowerCase();
        const debugPlatform = debugPlatforms[platform];
        if (!debugPlatform) {
            const availablePlatforms = Object.getOwnPropertyNames(debugPlatforms);
            return reject(new Error(`"${platform}" is an unsupported platform. Available options are ${availablePlatforms.join(", ")}.`));
        }
        try {
            const logProcess = debugPlatform.getLogProcess();
            console.log(`Listening for ${platform} debug logs (Press CTRL+C to exit)`);
            logProcess.stdout.on("data", processLogData.bind(debugPlatform));
            logProcess.stderr.on("data", reject);
            logProcess.on("close", resolve);
        }
        catch (e) {
            reject(e);
        }
    });
}
exports.default = default_1;
