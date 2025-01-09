"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReactNativeBundleCommand = exports.releaseReact = exports.release = exports.execute = exports.deploymentList = exports.createEmptyTempReleaseFolder = exports.confirm = exports.execSync = exports.spawn = exports.sdk = exports.log = void 0;
const AccountManager = require("./management-sdk");
const childProcess = require("child_process");
const debug_1 = require("./commands/debug");
const fs = require("fs");
const chalk = require("chalk");
const g2js = require("gradle-to-js/lib/parser");
const moment = require("moment");
const opener = require("opener");
const os = require("os");
const path = require("path");
const plist = require("plist");
const progress = require("progress");
const prompt = require("prompt");
const Q = require("q");
const rimraf = require("rimraf");
const semver = require("semver");
const Table = require("cli-table");
const which = require("which");
const wordwrap = require("wordwrap");
const cli = require("../script/types/cli");
const sign_1 = require("./sign");
const xcode = require("xcode");
const react_native_utils_1 = require("./react-native-utils");
const file_utils_1 = require("./utils/file-utils");
const configFilePath = path.join(process.env.LOCALAPPDATA || process.env.HOME, ".code-push.config");
const emailValidator = require("email-validator");
const packageJson = require("../../package.json");
const parseXml = Q.denodeify(require("xml2js").parseString);
var Promise = Q.Promise;
const properties = require("properties");
const CLI_HEADERS = {
    "X-CodePush-CLI-Version": packageJson.version,
};
const log = (message) => console.log(message);
exports.log = log;
exports.spawn = childProcess.spawn;
exports.execSync = childProcess.execSync;
let connectionInfo;
const confirm = (message = "Are you sure?") => {
    message += " (y/N):";
    return Promise((resolve, reject, notify) => {
        prompt.message = "";
        prompt.delimiter = "";
        prompt.start();
        prompt.get({
            properties: {
                response: {
                    description: chalk.cyan(message),
                },
            },
        }, (err, result) => {
            const accepted = result.response && result.response.toLowerCase() === "y";
            const rejected = !result.response || result.response.toLowerCase() === "n";
            if (accepted) {
                resolve(true);
            }
            else {
                if (!rejected) {
                    console.log('Invalid response: "' + result.response + '"');
                }
                resolve(false);
            }
        });
    });
};
exports.confirm = confirm;
function accessKeyAdd(command) {
    return exports.sdk.addAccessKey(command.name, command.ttl).then((accessKey) => {
        (0, exports.log)(`Successfully created the "${command.name}" access key: ${accessKey.key}`);
        (0, exports.log)("Make sure to save this key value somewhere safe, since you won't be able to view it from the CLI again!");
    });
}
function accessKeyPatch(command) {
    const willUpdateName = isCommandOptionSpecified(command.newName) && command.oldName !== command.newName;
    const willUpdateTtl = isCommandOptionSpecified(command.ttl);
    if (!willUpdateName && !willUpdateTtl) {
        throw new Error("A new name and/or TTL must be provided.");
    }
    return exports.sdk.patchAccessKey(command.oldName, command.newName, command.ttl).then((accessKey) => {
        let logMessage = "Successfully ";
        if (willUpdateName) {
            logMessage += `renamed the access key "${command.oldName}" to "${command.newName}"`;
        }
        if (willUpdateTtl) {
            const expirationDate = moment(accessKey.expires).format("LLLL");
            if (willUpdateName) {
                logMessage += ` and changed its expiration date to ${expirationDate}`;
            }
            else {
                logMessage += `changed the expiration date of the "${command.oldName}" access key to ${expirationDate}`;
            }
        }
        (0, exports.log)(`${logMessage}.`);
    });
}
function accessKeyList(command) {
    throwForInvalidOutputFormat(command.format);
    return exports.sdk.getAccessKeys().then((accessKeys) => {
        printAccessKeys(command.format, accessKeys);
    });
}
function accessKeyRemove(command) {
    return (0, exports.confirm)().then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.removeAccessKey(command.accessKey).then(() => {
                (0, exports.log)(`Successfully removed the "${command.accessKey}" access key.`);
            });
        }
        (0, exports.log)("Access key removal cancelled.");
    });
}
function appAdd(command) {
    return exports.sdk.addApp(command.appName).then((app) => {
        (0, exports.log)('Successfully added the "' + command.appName + '" app, along with the following default deployments:');
        const deploymentListCommand = {
            type: cli.CommandType.deploymentList,
            appName: app.name,
            format: "table",
            displayKeys: true,
        };
        return (0, exports.deploymentList)(deploymentListCommand, /*showPackage=*/ false);
    });
}
function appList(command) {
    throwForInvalidOutputFormat(command.format);
    let apps;
    return exports.sdk.getApps().then((retrievedApps) => {
        printAppList(command.format, retrievedApps);
    });
}
function appRemove(command) {
    return (0, exports.confirm)("Are you sure you want to remove this app? Note that its deployment keys will be PERMANENTLY unrecoverable.").then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.removeApp(command.appName).then(() => {
                (0, exports.log)('Successfully removed the "' + command.appName + '" app.');
            });
        }
        (0, exports.log)("App removal cancelled.");
    });
}
function appRename(command) {
    return exports.sdk.renameApp(command.currentAppName, command.newAppName).then(() => {
        (0, exports.log)('Successfully renamed the "' + command.currentAppName + '" app to "' + command.newAppName + '".');
    });
}
const createEmptyTempReleaseFolder = (folderPath) => {
    return deleteFolder(folderPath).then(() => {
        fs.mkdirSync(folderPath);
    });
};
exports.createEmptyTempReleaseFolder = createEmptyTempReleaseFolder;
function appTransfer(command) {
    throwForInvalidEmail(command.email);
    return (0, exports.confirm)().then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.transferApp(command.appName, command.email).then(() => {
                (0, exports.log)('Successfully transferred the ownership of app "' + command.appName + '" to the account with email "' + command.email + '".');
            });
        }
        (0, exports.log)("App transfer cancelled.");
    });
}
function addCollaborator(command) {
    throwForInvalidEmail(command.email);
    return exports.sdk.addCollaborator(command.appName, command.email).then(() => {
        (0, exports.log)('Successfully added "' + command.email + '" as a collaborator to the app "' + command.appName + '".');
    });
}
function listCollaborators(command) {
    throwForInvalidOutputFormat(command.format);
    return exports.sdk.getCollaborators(command.appName).then((retrievedCollaborators) => {
        printCollaboratorsList(command.format, retrievedCollaborators);
    });
}
function removeCollaborator(command) {
    throwForInvalidEmail(command.email);
    return (0, exports.confirm)().then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.removeCollaborator(command.appName, command.email).then(() => {
                (0, exports.log)('Successfully removed "' + command.email + '" as a collaborator from the app "' + command.appName + '".');
            });
        }
        (0, exports.log)("App collaborator removal cancelled.");
    });
}
function deleteConnectionInfoCache(printMessage = true) {
    try {
        fs.unlinkSync(configFilePath);
        if (printMessage) {
            (0, exports.log)(`Successfully logged-out. The session file located at ${chalk.cyan(configFilePath)} has been deleted.\r\n`);
        }
    }
    catch (ex) { }
}
function deleteFolder(folderPath) {
    return Promise((resolve, reject, notify) => {
        rimraf(folderPath, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(null);
            }
        });
    });
}
function deploymentAdd(command) {
    return exports.sdk.addDeployment(command.appName, command.deploymentName, command.key).then((deployment) => {
        (0, exports.log)('Successfully added the "' +
            command.deploymentName +
            '" deployment with key "' +
            deployment.key +
            '" to the "' +
            command.appName +
            '" app.');
    });
}
function deploymentHistoryClear(command) {
    return (0, exports.confirm)().then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.clearDeploymentHistory(command.appName, command.deploymentName).then(() => {
                (0, exports.log)('Successfully cleared the release history associated with the "' +
                    command.deploymentName +
                    '" deployment from the "' +
                    command.appName +
                    '" app.');
            });
        }
        (0, exports.log)("Clear deployment cancelled.");
    });
}
const deploymentList = (command, showPackage = true) => {
    throwForInvalidOutputFormat(command.format);
    let deployments;
    return exports.sdk
        .getDeployments(command.appName)
        .then((retrievedDeployments) => {
        deployments = retrievedDeployments;
        if (showPackage) {
            const metricsPromises = deployments.map((deployment) => {
                if (deployment.package) {
                    return exports.sdk.getDeploymentMetrics(command.appName, deployment.name).then((metrics) => {
                        if (metrics[deployment.package.label]) {
                            const totalActive = getTotalActiveFromDeploymentMetrics(metrics);
                            deployment.package.metrics = {
                                active: metrics[deployment.package.label].active,
                                downloaded: metrics[deployment.package.label].downloaded,
                                failed: metrics[deployment.package.label].failed,
                                installed: metrics[deployment.package.label].installed,
                                totalActive: totalActive,
                            };
                        }
                    });
                }
                else {
                    return Q(null);
                }
            });
            return Q.all(metricsPromises);
        }
    })
        .then(() => {
        printDeploymentList(command, deployments, showPackage);
    });
};
exports.deploymentList = deploymentList;
function deploymentRemove(command) {
    return (0, exports.confirm)("Are you sure you want to remove this deployment? Note that its deployment key will be PERMANENTLY unrecoverable.").then((wasConfirmed) => {
        if (wasConfirmed) {
            return exports.sdk.removeDeployment(command.appName, command.deploymentName).then(() => {
                (0, exports.log)('Successfully removed the "' + command.deploymentName + '" deployment from the "' + command.appName + '" app.');
            });
        }
        (0, exports.log)("Deployment removal cancelled.");
    });
}
function deploymentRename(command) {
    return exports.sdk.renameDeployment(command.appName, command.currentDeploymentName, command.newDeploymentName).then(() => {
        (0, exports.log)('Successfully renamed the "' +
            command.currentDeploymentName +
            '" deployment to "' +
            command.newDeploymentName +
            '" for the "' +
            command.appName +
            '" app.');
    });
}
function deploymentHistory(command) {
    throwForInvalidOutputFormat(command.format);
    return Q.all([
        exports.sdk.getAccountInfo(),
        exports.sdk.getDeploymentHistory(command.appName, command.deploymentName),
        exports.sdk.getDeploymentMetrics(command.appName, command.deploymentName),
    ]).spread((account, deploymentHistory, metrics) => {
        const totalActive = getTotalActiveFromDeploymentMetrics(metrics);
        deploymentHistory.forEach((packageObject) => {
            if (metrics[packageObject.label]) {
                packageObject.metrics = {
                    active: metrics[packageObject.label].active,
                    downloaded: metrics[packageObject.label].downloaded,
                    failed: metrics[packageObject.label].failed,
                    installed: metrics[packageObject.label].installed,
                    totalActive: totalActive,
                };
            }
        });
        printDeploymentHistory(command, deploymentHistory, account.email);
    });
}
function deserializeConnectionInfo() {
    try {
        const savedConnection = fs.readFileSync(configFilePath, {
            encoding: "utf8",
        });
        let connectionInfo = JSON.parse(savedConnection);
        // If the connection info is in the legacy format, convert it to the modern format
        if (connectionInfo.accessKeyName) {
            connectionInfo = {
                accessKey: connectionInfo.accessKeyName,
            };
        }
        const connInfo = connectionInfo;
        return connInfo;
    }
    catch (ex) {
        return;
    }
}
function execute(command) {
    connectionInfo = deserializeConnectionInfo();
    return Q(null).then(() => {
        switch (command.type) {
            // Must not be logged in
            case cli.CommandType.login:
            case cli.CommandType.register:
                if (connectionInfo) {
                    throw new Error("You are already logged in from this machine.");
                }
                break;
            // It does not matter whether you are logged in or not
            case cli.CommandType.link:
                break;
            // Must be logged in
            default:
                if (!!exports.sdk)
                    break; // Used by unit tests to skip authentication
                if (!connectionInfo) {
                    throw new Error("You are not currently logged in. Run the 'code-push-standalone login' command to authenticate with the CodePush server.");
                }
                exports.sdk = getSdk(connectionInfo.accessKey, CLI_HEADERS, connectionInfo.customServerUrl);
                break;
        }
        switch (command.type) {
            case cli.CommandType.accessKeyAdd:
                return accessKeyAdd(command);
            case cli.CommandType.accessKeyPatch:
                return accessKeyPatch(command);
            case cli.CommandType.accessKeyList:
                return accessKeyList(command);
            case cli.CommandType.accessKeyRemove:
                return accessKeyRemove(command);
            case cli.CommandType.appAdd:
                return appAdd(command);
            case cli.CommandType.appList:
                return appList(command);
            case cli.CommandType.appRemove:
                return appRemove(command);
            case cli.CommandType.appRename:
                return appRename(command);
            case cli.CommandType.appTransfer:
                return appTransfer(command);
            case cli.CommandType.collaboratorAdd:
                return addCollaborator(command);
            case cli.CommandType.collaboratorList:
                return listCollaborators(command);
            case cli.CommandType.collaboratorRemove:
                return removeCollaborator(command);
            case cli.CommandType.debug:
                return (0, debug_1.default)(command);
            case cli.CommandType.deploymentAdd:
                return deploymentAdd(command);
            case cli.CommandType.deploymentHistoryClear:
                return deploymentHistoryClear(command);
            case cli.CommandType.deploymentHistory:
                return deploymentHistory(command);
            case cli.CommandType.deploymentList:
                return (0, exports.deploymentList)(command);
            case cli.CommandType.deploymentRemove:
                return deploymentRemove(command);
            case cli.CommandType.deploymentRename:
                return deploymentRename(command);
            case cli.CommandType.link:
                return link(command);
            case cli.CommandType.login:
                return login(command);
            case cli.CommandType.logout:
                return logout(command);
            case cli.CommandType.patch:
                return patch(command);
            case cli.CommandType.promote:
                return promote(command);
            case cli.CommandType.register:
                return register(command);
            case cli.CommandType.release:
                return (0, exports.release)(command);
            case cli.CommandType.releaseReact:
                return (0, exports.releaseReact)(command);
            case cli.CommandType.rollback:
                return rollback(command);
            case cli.CommandType.sessionList:
                return sessionList(command);
            case cli.CommandType.sessionRemove:
                return sessionRemove(command);
            case cli.CommandType.whoami:
                return whoami(command);
            default:
                // We should never see this message as invalid commands should be caught by the argument parser.
                throw new Error("Invalid command:  " + JSON.stringify(command));
        }
    });
}
exports.execute = execute;
function getTotalActiveFromDeploymentMetrics(metrics) {
    let totalActive = 0;
    Object.keys(metrics).forEach((label) => {
        totalActive += metrics[label].active;
    });
    return totalActive;
}
function initiateExternalAuthenticationAsync(action, serverUrl) {
    const message = `A browser is being launched to authenticate your account. Follow the instructions ` +
        `it displays to complete your ${action === "register" ? "registration" : action}.`;
    (0, exports.log)(message);
    const hostname = os.hostname();
    const url = `${serverUrl || AccountManager.SERVER_URL}/auth/${action}?hostname=${hostname}`;
    opener(url);
}
function link(command) {
    initiateExternalAuthenticationAsync("link", command.serverUrl);
    return Q(null);
}
function login(command) {
    // Check if one of the flags were provided.
    if (command.accessKey) {
        exports.sdk = getSdk(command.accessKey, CLI_HEADERS, command.serverUrl);
        return exports.sdk.isAuthenticated().then((isAuthenticated) => {
            if (isAuthenticated) {
                serializeConnectionInfo(command.accessKey, /*preserveAccessKeyOnLogout*/ true, command.serverUrl);
            }
            else {
                throw new Error("Invalid access key.");
            }
        });
    }
    else {
        return loginWithExternalAuthentication("login", command.serverUrl);
    }
}
function loginWithExternalAuthentication(action, serverUrl) {
    initiateExternalAuthenticationAsync(action, serverUrl);
    (0, exports.log)(""); // Insert newline
    return requestAccessKey().then((accessKey) => {
        if (accessKey === null) {
            // The user has aborted the synchronous prompt (e.g.:  via [CTRL]+[C]).
            return;
        }
        exports.sdk = getSdk(accessKey, CLI_HEADERS, serverUrl);
        return exports.sdk.isAuthenticated().then((isAuthenticated) => {
            if (isAuthenticated) {
                serializeConnectionInfo(accessKey, /*preserveAccessKeyOnLogout*/ false, serverUrl);
            }
            else {
                throw new Error("Invalid access key.");
            }
        });
    });
}
function logout(command) {
    return Q(null)
        .then(() => {
        if (!connectionInfo.preserveAccessKeyOnLogout) {
            const machineName = os.hostname();
            return exports.sdk.removeSession(machineName).catch((error) => {
                // If we are not authenticated or the session doesn't exist anymore, just swallow the error instead of displaying it
                if (error.statusCode !== AccountManager.ERROR_UNAUTHORIZED && error.statusCode !== AccountManager.ERROR_NOT_FOUND) {
                    throw error;
                }
            });
        }
    })
        .then(() => {
        exports.sdk = null;
        deleteConnectionInfoCache();
    });
}
function formatDate(unixOffset) {
    const date = moment(unixOffset);
    const now = moment();
    if (Math.abs(now.diff(date, "days")) < 30) {
        return date.fromNow(); // "2 hours ago"
    }
    else if (now.year() === date.year()) {
        return date.format("MMM D"); // "Nov 6"
    }
    else {
        return date.format("MMM D, YYYY"); // "Nov 6, 2014"
    }
}
function printAppList(format, apps) {
    if (format === "json") {
        printJson(apps);
    }
    else if (format === "table") {
        const headers = ["Name", "Deployments"];
        printTable(headers, (dataSource) => {
            apps.forEach((app, index) => {
                const row = [app.name, wordwrap(50)(app.deployments.join(", "))];
                dataSource.push(row);
            });
        });
    }
}
function getCollaboratorDisplayName(email, collaboratorProperties) {
    return collaboratorProperties.permission === AccountManager.AppPermission.OWNER ? email + chalk.magenta(" (Owner)") : email;
}
function printCollaboratorsList(format, collaborators) {
    if (format === "json") {
        const dataSource = { collaborators: collaborators };
        printJson(dataSource);
    }
    else if (format === "table") {
        const headers = ["E-mail Address"];
        printTable(headers, (dataSource) => {
            Object.keys(collaborators).forEach((email) => {
                const row = [getCollaboratorDisplayName(email, collaborators[email])];
                dataSource.push(row);
            });
        });
    }
}
function printDeploymentList(command, deployments, showPackage = true) {
    if (command.format === "json") {
        printJson(deployments);
    }
    else if (command.format === "table") {
        const headers = ["Name"];
        if (command.displayKeys) {
            headers.push("Deployment Key");
        }
        if (showPackage) {
            headers.push("Update Metadata");
            headers.push("Install Metrics");
        }
        printTable(headers, (dataSource) => {
            deployments.forEach((deployment) => {
                const row = [deployment.name];
                if (command.displayKeys) {
                    row.push(deployment.key);
                }
                if (showPackage) {
                    row.push(getPackageString(deployment.package));
                    row.push(getPackageMetricsString(deployment.package));
                }
                dataSource.push(row);
            });
        });
    }
}
function printDeploymentHistory(command, deploymentHistory, currentUserEmail) {
    if (command.format === "json") {
        printJson(deploymentHistory);
    }
    else if (command.format === "table") {
        const headers = ["Label", "Release Time", "App Version", "Mandatory"];
        if (command.displayAuthor) {
            headers.push("Released By");
        }
        headers.push("Description", "Install Metrics");
        printTable(headers, (dataSource) => {
            deploymentHistory.forEach((packageObject) => {
                let releaseTime = formatDate(packageObject.uploadTime);
                let releaseSource;
                if (packageObject.releaseMethod === "Promote") {
                    releaseSource = `Promoted ${packageObject.originalLabel} from "${packageObject.originalDeployment}"`;
                }
                else if (packageObject.releaseMethod === "Rollback") {
                    const labelNumber = parseInt(packageObject.label.substring(1));
                    const lastLabel = "v" + (labelNumber - 1);
                    releaseSource = `Rolled back ${lastLabel} to ${packageObject.originalLabel}`;
                }
                if (releaseSource) {
                    releaseTime += "\n" + chalk.magenta(`(${releaseSource})`).toString();
                }
                let row = [packageObject.label, releaseTime, packageObject.appVersion, packageObject.isMandatory ? "Yes" : "No"];
                if (command.displayAuthor) {
                    let releasedBy = packageObject.releasedBy ? packageObject.releasedBy : "";
                    if (currentUserEmail && releasedBy === currentUserEmail) {
                        releasedBy = "You";
                    }
                    row.push(releasedBy);
                }
                row.push(packageObject.description ? wordwrap(30)(packageObject.description) : "");
                row.push(getPackageMetricsString(packageObject) + (packageObject.isDisabled ? `\n${chalk.green("Disabled:")} Yes` : ""));
                if (packageObject.isDisabled) {
                    row = row.map((cellContents) => applyChalkSkippingLineBreaks(cellContents, chalk.dim));
                }
                dataSource.push(row);
            });
        });
    }
}
function applyChalkSkippingLineBreaks(applyString, chalkMethod) {
    // Used to prevent "chalk" from applying styles to linebreaks which
    // causes table border chars to have the style applied as well.
    return applyString
        .split("\n")
        .map((token) => chalkMethod(token))
        .join("\n");
}
function getPackageString(packageObject) {
    if (!packageObject) {
        return chalk.magenta("No updates released").toString();
    }
    let packageString = chalk.green("Label: ") +
        packageObject.label +
        "\n" +
        chalk.green("App Version: ") +
        packageObject.appVersion +
        "\n" +
        chalk.green("Mandatory: ") +
        (packageObject.isMandatory ? "Yes" : "No") +
        "\n" +
        chalk.green("Release Time: ") +
        formatDate(packageObject.uploadTime) +
        "\n" +
        chalk.green("Released By: ") +
        (packageObject.releasedBy ? packageObject.releasedBy : "") +
        (packageObject.description ? wordwrap(70)("\n" + chalk.green("Description: ") + packageObject.description) : "");
    if (packageObject.isDisabled) {
        packageString += `\n${chalk.green("Disabled:")} Yes`;
    }
    return packageString;
}
function getPackageMetricsString(obj) {
    const packageObject = obj;
    const rolloutString = obj && obj.rollout && obj.rollout !== 100 ? `\n${chalk.green("Rollout:")} ${obj.rollout.toLocaleString()}%` : "";
    if (!packageObject || !packageObject.metrics) {
        return chalk.magenta("No installs recorded").toString() + (rolloutString || "");
    }
    const activePercent = packageObject.metrics.totalActive
        ? (packageObject.metrics.active / packageObject.metrics.totalActive) * 100
        : 0.0;
    let percentString;
    if (activePercent === 100.0) {
        percentString = "100%";
    }
    else if (activePercent === 0.0) {
        percentString = "0%";
    }
    else {
        percentString = activePercent.toPrecision(2) + "%";
    }
    const numPending = packageObject.metrics.downloaded - packageObject.metrics.installed - packageObject.metrics.failed;
    let returnString = chalk.green("Active: ") +
        percentString +
        " (" +
        packageObject.metrics.active.toLocaleString() +
        " of " +
        packageObject.metrics.totalActive.toLocaleString() +
        ")\n" +
        chalk.green("Total: ") +
        packageObject.metrics.installed.toLocaleString();
    if (numPending > 0) {
        returnString += " (" + numPending.toLocaleString() + " pending)";
    }
    if (packageObject.metrics.failed) {
        returnString += "\n" + chalk.green("Rollbacks: ") + chalk.red(packageObject.metrics.failed.toLocaleString() + "");
    }
    if (rolloutString) {
        returnString += rolloutString;
    }
    return returnString;
}
function getReactNativeProjectAppVersion(command, projectName) {
    (0, exports.log)(chalk.cyan(`Detecting ${command.platform} app version:\n`));
    if (command.platform === "ios") {
        let resolvedPlistFile = command.plistFile;
        if (resolvedPlistFile) {
            // If a plist file path is explicitly provided, then we don't
            // need to attempt to "resolve" it within the well-known locations.
            if (!(0, file_utils_1.fileExists)(resolvedPlistFile)) {
                throw new Error("The specified plist file doesn't exist. Please check that the provided path is correct.");
            }
        }
        else {
            // Allow the plist prefix to be specified with or without a trailing
            // separator character, but prescribe the use of a hyphen when omitted,
            // since this is the most commonly used convetion for plist files.
            if (command.plistFilePrefix && /.+[^-.]$/.test(command.plistFilePrefix)) {
                command.plistFilePrefix += "-";
            }
            const iOSDirectory = "ios";
            const plistFileName = `${command.plistFilePrefix || ""}Info.plist`;
            const knownLocations = [path.join(iOSDirectory, projectName, plistFileName), path.join(iOSDirectory, plistFileName)];
            resolvedPlistFile = knownLocations.find(file_utils_1.fileExists);
            if (!resolvedPlistFile) {
                throw new Error(`Unable to find either of the following plist files in order to infer your app's binary version: "${knownLocations.join('", "')}". If your plist has a different name, or is located in a different directory, consider using either the "--plistFile" or "--plistFilePrefix" parameters to help inform the CLI how to find it.`);
            }
        }
        const plistContents = fs.readFileSync(resolvedPlistFile).toString();
        let parsedPlist;
        try {
            parsedPlist = plist.parse(plistContents);
        }
        catch (e) {
            throw new Error(`Unable to parse "${resolvedPlistFile}". Please ensure it is a well-formed plist file.`);
        }
        if (parsedPlist && parsedPlist.CFBundleShortVersionString) {
            if ((0, react_native_utils_1.isValidVersion)(parsedPlist.CFBundleShortVersionString)) {
                (0, exports.log)(`Using the target binary version value "${parsedPlist.CFBundleShortVersionString}" from "${resolvedPlistFile}".\n`);
                return Q(parsedPlist.CFBundleShortVersionString);
            }
            else {
                if (parsedPlist.CFBundleShortVersionString !== "$(MARKETING_VERSION)") {
                    throw new Error(`The "CFBundleShortVersionString" key in the "${resolvedPlistFile}" file needs to specify a valid semver string, containing both a major and minor version (e.g. 1.3.2, 1.1).`);
                }
                return getAppVersionFromXcodeProject(command, projectName);
            }
        }
        else {
            throw new Error(`The "CFBundleShortVersionString" key doesn't exist within the "${resolvedPlistFile}" file.`);
        }
    }
    else if (command.platform === "android") {
        let buildGradlePath = path.join("android", "app");
        if (command.gradleFile) {
            buildGradlePath = command.gradleFile;
        }
        if (fs.lstatSync(buildGradlePath).isDirectory()) {
            buildGradlePath = path.join(buildGradlePath, "build.gradle");
        }
        if ((0, file_utils_1.fileDoesNotExistOrIsDirectory)(buildGradlePath)) {
            throw new Error(`Unable to find gradle file "${buildGradlePath}".`);
        }
        return g2js
            .parseFile(buildGradlePath)
            .catch(() => {
            throw new Error(`Unable to parse the "${buildGradlePath}" file. Please ensure it is a well-formed Gradle file.`);
        })
            .then((buildGradle) => {
            let versionName = null;
            // First 'if' statement was implemented as workaround for case
            // when 'build.gradle' file contains several 'android' nodes.
            // In this case 'buildGradle.android' prop represents array instead of object
            // due to parsing issue in 'g2js.parseFile' method.
            if (buildGradle.android instanceof Array) {
                for (let i = 0; i < buildGradle.android.length; i++) {
                    const gradlePart = buildGradle.android[i];
                    if (gradlePart.defaultConfig && gradlePart.defaultConfig.versionName) {
                        versionName = gradlePart.defaultConfig.versionName;
                        break;
                    }
                }
            }
            else if (buildGradle.android && buildGradle.android.defaultConfig && buildGradle.android.defaultConfig.versionName) {
                versionName = buildGradle.android.defaultConfig.versionName;
            }
            else {
                throw new Error(`The "${buildGradlePath}" file doesn't specify a value for the "android.defaultConfig.versionName" property.`);
            }
            if (typeof versionName !== "string") {
                throw new Error(`The "android.defaultConfig.versionName" property value in "${buildGradlePath}" is not a valid string. If this is expected, consider using the --targetBinaryVersion option to specify the value manually.`);
            }
            let appVersion = versionName.replace(/"/g, "").trim();
            if ((0, react_native_utils_1.isValidVersion)(appVersion)) {
                // The versionName property is a valid semver string,
                // so we can safely use that and move on.
                (0, exports.log)(`Using the target binary version value "${appVersion}" from "${buildGradlePath}".\n`);
                return appVersion;
            }
            else if (/^\d.*/.test(appVersion)) {
                // The versionName property isn't a valid semver string,
                // but it starts with a number, and therefore, it can't
                // be a valid Gradle property reference.
                throw new Error(`The "android.defaultConfig.versionName" property in the "${buildGradlePath}" file needs to specify a valid semver string, containing both a major and minor version (e.g. 1.3.2, 1.1).`);
            }
            // The version property isn't a valid semver string
            // so we assume it is a reference to a property variable.
            const propertyName = appVersion.replace("project.", "");
            const propertiesFileName = "gradle.properties";
            const knownLocations = [path.join("android", "app", propertiesFileName), path.join("android", propertiesFileName)];
            // Search for gradle properties across all `gradle.properties` files
            let propertiesFile = null;
            for (let i = 0; i < knownLocations.length; i++) {
                propertiesFile = knownLocations[i];
                if ((0, file_utils_1.fileExists)(propertiesFile)) {
                    const propertiesContent = fs.readFileSync(propertiesFile).toString();
                    try {
                        const parsedProperties = properties.parse(propertiesContent);
                        appVersion = parsedProperties[propertyName];
                        if (appVersion) {
                            break;
                        }
                    }
                    catch (e) {
                        throw new Error(`Unable to parse "${propertiesFile}". Please ensure it is a well-formed properties file.`);
                    }
                }
            }
            if (!appVersion) {
                throw new Error(`No property named "${propertyName}" exists in the "${propertiesFile}" file.`);
            }
            if (!(0, react_native_utils_1.isValidVersion)(appVersion)) {
                throw new Error(`The "${propertyName}" property in the "${propertiesFile}" file needs to specify a valid semver string, containing both a major and minor version (e.g. 1.3.2, 1.1).`);
            }
            (0, exports.log)(`Using the target binary version value "${appVersion}" from the "${propertyName}" key in the "${propertiesFile}" file.\n`);
            return appVersion.toString();
        });
    }
    else {
        const appxManifestFileName = "Package.appxmanifest";
        let appxManifestContainingFolder;
        let appxManifestContents;
        try {
            appxManifestContainingFolder = path.join("windows", projectName);
            appxManifestContents = fs.readFileSync(path.join(appxManifestContainingFolder, "Package.appxmanifest")).toString();
        }
        catch (err) {
            throw new Error(`Unable to find or read "${appxManifestFileName}" in the "${path.join("windows", projectName)}" folder.`);
        }
        return parseXml(appxManifestContents)
            .catch((err) => {
            throw new Error(`Unable to parse the "${path.join(appxManifestContainingFolder, appxManifestFileName)}" file, it could be malformed.`);
        })
            .then((parsedAppxManifest) => {
            try {
                return parsedAppxManifest.Package.Identity[0]["$"].Version.match(/^\d+\.\d+\.\d+/)[0];
            }
            catch (e) {
                throw new Error(`Unable to parse the package version from the "${path.join(appxManifestContainingFolder, appxManifestFileName)}" file.`);
            }
        });
    }
}
function getAppVersionFromXcodeProject(command, projectName) {
    const pbxprojFileName = "project.pbxproj";
    let resolvedPbxprojFile = command.xcodeProjectFile;
    if (resolvedPbxprojFile) {
        // If the xcode project file path is explicitly provided, then we don't
        // need to attempt to "resolve" it within the well-known locations.
        if (!resolvedPbxprojFile.endsWith(pbxprojFileName)) {
            // Specify path to pbxproj file if the provided file path is an Xcode project file.
            resolvedPbxprojFile = path.join(resolvedPbxprojFile, pbxprojFileName);
        }
        if (!(0, file_utils_1.fileExists)(resolvedPbxprojFile)) {
            throw new Error("The specified pbx project file doesn't exist. Please check that the provided path is correct.");
        }
    }
    else {
        const iOSDirectory = "ios";
        const xcodeprojDirectory = `${projectName}.xcodeproj`;
        const pbxprojKnownLocations = [
            path.join(iOSDirectory, xcodeprojDirectory, pbxprojFileName),
            path.join(iOSDirectory, pbxprojFileName),
        ];
        resolvedPbxprojFile = pbxprojKnownLocations.find(file_utils_1.fileExists);
        if (!resolvedPbxprojFile) {
            throw new Error(`Unable to find either of the following pbxproj files in order to infer your app's binary version: "${pbxprojKnownLocations.join('", "')}".`);
        }
    }
    const xcodeProj = xcode.project(resolvedPbxprojFile).parseSync();
    const marketingVersion = xcodeProj.getBuildProperty("MARKETING_VERSION", command.buildConfigurationName, command.xcodeTargetName);
    if (!(0, react_native_utils_1.isValidVersion)(marketingVersion)) {
        throw new Error(`The "MARKETING_VERSION" key in the "${resolvedPbxprojFile}" file needs to specify a valid semver string, containing both a major and minor version (e.g. 1.3.2, 1.1).`);
    }
    console.log(`Using the target binary version value "${marketingVersion}" from "${resolvedPbxprojFile}".\n`);
    return marketingVersion;
}
function printJson(object) {
    (0, exports.log)(JSON.stringify(object, /*replacer=*/ null, /*spacing=*/ 2));
}
function printAccessKeys(format, keys) {
    if (format === "json") {
        printJson(keys);
    }
    else if (format === "table") {
        printTable(["Name", "Created", "Expires"], (dataSource) => {
            const now = new Date().getTime();
            function isExpired(key) {
                return now >= key.expires;
            }
            function keyToTableRow(key, dim) {
                const row = [key.name, key.createdTime ? formatDate(key.createdTime) : "", formatDate(key.expires)];
                if (dim) {
                    row.forEach((col, index) => {
                        row[index] = chalk.dim(col);
                    });
                }
                return row;
            }
            keys.forEach((key) => !isExpired(key) && dataSource.push(keyToTableRow(key, /*dim*/ false)));
            keys.forEach((key) => isExpired(key) && dataSource.push(keyToTableRow(key, /*dim*/ true)));
        });
    }
}
function printSessions(format, sessions) {
    if (format === "json") {
        printJson(sessions);
    }
    else if (format === "table") {
        printTable(["Machine", "Logged in"], (dataSource) => {
            sessions.forEach((session) => dataSource.push([session.machineName, formatDate(session.loggedInTime)]));
        });
    }
}
function printTable(columnNames, readData) {
    const table = new Table({
        head: columnNames,
        style: { head: ["cyan"] },
    });
    readData(table);
    (0, exports.log)(table.toString());
}
function register(command) {
    return loginWithExternalAuthentication("register", command.serverUrl);
}
function promote(command) {
    const packageInfo = {
        appVersion: command.appStoreVersion,
        description: command.description,
        label: command.label,
        isDisabled: command.disabled,
        isMandatory: command.mandatory,
        rollout: command.rollout,
    };
    return exports.sdk
        .promote(command.appName, command.sourceDeploymentName, command.destDeploymentName, packageInfo)
        .then(() => {
        (0, exports.log)("Successfully promoted " +
            (command.label !== null ? '"' + command.label + '" of ' : "") +
            'the "' +
            command.sourceDeploymentName +
            '" deployment of the "' +
            command.appName +
            '" app to the "' +
            command.destDeploymentName +
            '" deployment.');
    })
        .catch((err) => releaseErrorHandler(err, command));
}
function patch(command) {
    const packageInfo = {
        appVersion: command.appStoreVersion,
        description: command.description,
        isMandatory: command.mandatory,
        isDisabled: command.disabled,
        rollout: command.rollout,
    };
    for (const updateProperty in packageInfo) {
        if (packageInfo[updateProperty] !== null) {
            return exports.sdk.patchRelease(command.appName, command.deploymentName, command.label, packageInfo).then(() => {
                (0, exports.log)(`Successfully updated the "${command.label ? command.label : `latest`}" release of "${command.appName}" app's "${command.deploymentName}" deployment.`);
            });
        }
    }
    throw new Error("At least one property must be specified to patch a release.");
}
const release = (command) => {
    if ((0, file_utils_1.isBinaryOrZip)(command.package)) {
        throw new Error("It is unnecessary to package releases in a .zip or binary file. Please specify the direct path to the update content's directory (e.g. /platforms/ios/www) or file (e.g. main.jsbundle).");
    }
    throwForInvalidSemverRange(command.appStoreVersion);
    const filePath = command.package;
    let isSingleFilePackage = true;
    if (fs.lstatSync(filePath).isDirectory()) {
        isSingleFilePackage = false;
    }
    let lastTotalProgress = 0;
    const progressBar = new progress("Upload progress:[:bar] :percent :etas", {
        complete: "=",
        incomplete: " ",
        width: 50,
        total: 100,
    });
    const uploadProgress = (currentProgress) => {
        progressBar.tick(currentProgress - lastTotalProgress);
        lastTotalProgress = currentProgress;
    };
    const updateMetadata = {
        description: command.description,
        isDisabled: command.disabled,
        isMandatory: command.mandatory,
        rollout: command.rollout,
    };
    return exports.sdk
        .isAuthenticated(true)
        .then((isAuth) => {
        return exports.sdk.release(command.appName, command.deploymentName, filePath, command.appStoreVersion, updateMetadata, uploadProgress);
    })
        .then(() => {
        (0, exports.log)('Successfully released an update containing the "' +
            command.package +
            '" ' +
            (isSingleFilePackage ? "file" : "directory") +
            ' to the "' +
            command.deploymentName +
            '" deployment of the "' +
            command.appName +
            '" app.');
    })
        .catch((err) => releaseErrorHandler(err, command));
};
exports.release = release;
const releaseReact = (command) => {
    let bundleName = command.bundleName;
    let entryFile = command.entryFile;
    const outputFolder = command.outputDir || path.join(os.tmpdir(), "CodePush");
    const platform = (command.platform = command.platform.toLowerCase());
    const releaseCommand = command;
    // Check for app and deployment exist before releasing an update.
    // This validation helps to save about 1 minute or more in case user has typed wrong app or deployment name.
    return (exports.sdk
        .getDeployment(command.appName, command.deploymentName)
        .then(() => {
        releaseCommand.package = outputFolder;
        switch (platform) {
            case "android":
            case "ios":
            case "windows":
                if (!bundleName) {
                    bundleName = platform === "ios" ? "main.jsbundle" : `index.${platform}.bundle`;
                }
                break;
            default:
                throw new Error('Platform must be either "android", "ios" or "windows".');
        }
        let projectName;
        try {
            const projectPackageJson = require(path.join(process.cwd(), "package.json"));
            projectName = projectPackageJson.name;
            if (!projectName) {
                throw new Error('The "package.json" file in the CWD does not have the "name" field set.');
            }
            if (!projectPackageJson.dependencies["react-native"]) {
                throw new Error("The project in the CWD is not a React Native project.");
            }
        }
        catch (error) {
            throw new Error('Unable to find or read "package.json" in the CWD. The "release-react" command must be executed in a React Native project folder.');
        }
        if (!entryFile) {
            entryFile = `index.${platform}.js`;
            if ((0, file_utils_1.fileDoesNotExistOrIsDirectory)(entryFile)) {
                entryFile = "index.js";
            }
            if ((0, file_utils_1.fileDoesNotExistOrIsDirectory)(entryFile)) {
                throw new Error(`Entry file "index.${platform}.js" or "index.js" does not exist.`);
            }
        }
        else {
            if ((0, file_utils_1.fileDoesNotExistOrIsDirectory)(entryFile)) {
                throw new Error(`Entry file "${entryFile}" does not exist.`);
            }
        }
        const appVersionPromise = command.appStoreVersion
            ? Q(command.appStoreVersion)
            : getReactNativeProjectAppVersion(command, projectName);
        if (command.sourcemapOutput && !command.sourcemapOutput.endsWith(".map")) {
            command.sourcemapOutput = path.join(command.sourcemapOutput, bundleName + ".map");
        }
        return appVersionPromise;
    })
        .then((appVersion) => {
        throwForInvalidSemverRange(appVersion);
        releaseCommand.appStoreVersion = appVersion;
        return (0, exports.createEmptyTempReleaseFolder)(outputFolder);
    })
        // This is needed to clear the react native bundler cache:
        // https://github.com/facebook/react-native/issues/4289
        .then(() => deleteFolder(`${os.tmpdir()}/react-*`))
        .then(() => (0, exports.runReactNativeBundleCommand)(bundleName, command.development || false, entryFile, outputFolder, platform, command.sourcemapOutput))
        .then(async () => {
        const isHermesEnabled = command.useHermes ||
            (platform === "android" && (await (0, react_native_utils_1.getAndroidHermesEnabled)(command.gradleFile))) || // Check if we have to run hermes to compile JS to Byte Code if Hermes is enabled in build.gradle and we're releasing an Android build
            (platform === "ios" && (await (0, react_native_utils_1.getiOSHermesEnabled)(command.podFile))); // Check if we have to run hermes to compile JS to Byte Code if Hermes is enabled in Podfile and we're releasing an iOS build
        if (isHermesEnabled) {
            (0, exports.log)(chalk.cyan("\nRunning hermes compiler...\n"));
            await (0, react_native_utils_1.runHermesEmitBinaryCommand)(bundleName, outputFolder, command.sourcemapOutput, command.extraHermesFlags, command.gradleFile);
        }
    })
        .then(async () => {
        if (command.privateKeyPath) {
            (0, exports.log)(chalk.cyan("\nSigning the bundle:\n"));
            await (0, sign_1.default)(command.privateKeyPath, outputFolder);
        }
        else {
            console.log("private key was not provided");
        }
    })
        .then(() => {
        (0, exports.log)(chalk.cyan("\nReleasing update contents to CodePush:\n"));
        return (0, exports.release)(releaseCommand);
    })
        .then(() => {
        if (!command.outputDir) {
            deleteFolder(outputFolder);
        }
    })
        .catch((err) => {
        deleteFolder(outputFolder);
        throw err;
    }));
};
exports.releaseReact = releaseReact;
function rollback(command) {
    return (0, exports.confirm)().then((wasConfirmed) => {
        if (!wasConfirmed) {
            (0, exports.log)("Rollback cancelled.");
            return;
        }
        return exports.sdk.rollback(command.appName, command.deploymentName, command.targetRelease || undefined).then(() => {
            (0, exports.log)('Successfully performed a rollback on the "' + command.deploymentName + '" deployment of the "' + command.appName + '" app.');
        });
    });
}
function requestAccessKey() {
    return Promise((resolve, reject, notify) => {
        prompt.message = "";
        prompt.delimiter = "";
        prompt.start();
        prompt.get({
            properties: {
                response: {
                    description: chalk.cyan("Enter your access key: "),
                },
            },
        }, (err, result) => {
            if (err) {
                resolve(null);
            }
            else {
                resolve(result.response.trim());
            }
        });
    });
}
const runReactNativeBundleCommand = (bundleName, development, entryFile, outputFolder, platform, sourcemapOutput) => {
    const reactNativeBundleArgs = [];
    const envNodeArgs = process.env.CODE_PUSH_NODE_ARGS;
    if (typeof envNodeArgs !== "undefined") {
        Array.prototype.push.apply(reactNativeBundleArgs, envNodeArgs.trim().split(/\s+/));
    }
    const isOldCLI = fs.existsSync(path.join("node_modules", "react-native", "local-cli", "cli.js"));
    Array.prototype.push.apply(reactNativeBundleArgs, [
        isOldCLI ? path.join("node_modules", "react-native", "local-cli", "cli.js") : path.join("node_modules", "react-native", "cli.js"),
        "bundle",
        "--assets-dest",
        outputFolder,
        "--bundle-output",
        path.join(outputFolder, bundleName),
        "--dev",
        development,
        "--entry-file",
        entryFile,
        "--platform",
        platform,
    ]);
    if (sourcemapOutput) {
        reactNativeBundleArgs.push("--sourcemap-output", sourcemapOutput);
    }
    (0, exports.log)(chalk.cyan('Running "react-native bundle" command:\n'));
    const reactNativeBundleProcess = (0, exports.spawn)("node", reactNativeBundleArgs);
    (0, exports.log)(`node ${reactNativeBundleArgs.join(" ")}`);
    return Promise((resolve, reject, notify) => {
        reactNativeBundleProcess.stdout.on("data", (data) => {
            (0, exports.log)(data.toString().trim());
        });
        reactNativeBundleProcess.stderr.on("data", (data) => {
            console.error(data.toString().trim());
        });
        reactNativeBundleProcess.on("close", (exitCode) => {
            if (exitCode) {
                reject(new Error(`"react-native bundle" command exited with code ${exitCode}.`));
            }
            resolve(null);
        });
    });
};
exports.runReactNativeBundleCommand = runReactNativeBundleCommand;
function serializeConnectionInfo(accessKey, preserveAccessKeyOnLogout, customServerUrl) {
    const connectionInfo = {
        accessKey: accessKey,
        preserveAccessKeyOnLogout: preserveAccessKeyOnLogout,
    };
    if (customServerUrl) {
        connectionInfo.customServerUrl = customServerUrl;
    }
    const json = JSON.stringify(connectionInfo);
    fs.writeFileSync(configFilePath, json, { encoding: "utf8" });
    (0, exports.log)(`\r\nSuccessfully logged-in. Your session file was written to ${chalk.cyan(configFilePath)}. You can run the ${chalk.cyan("code-push logout")} command at any time to delete this file and terminate your session.\r\n`);
}
function sessionList(command) {
    throwForInvalidOutputFormat(command.format);
    return exports.sdk.getSessions().then((sessions) => {
        printSessions(command.format, sessions);
    });
}
function sessionRemove(command) {
    if (os.hostname() === command.machineName) {
        throw new Error("Cannot remove the current login session via this command. Please run 'code-push-standalone logout' instead.");
    }
    else {
        return (0, exports.confirm)().then((wasConfirmed) => {
            if (wasConfirmed) {
                return exports.sdk.removeSession(command.machineName).then(() => {
                    (0, exports.log)(`Successfully removed the login session for "${command.machineName}".`);
                });
            }
            (0, exports.log)("Session removal cancelled.");
        });
    }
}
function releaseErrorHandler(error, command) {
    if (command.noDuplicateReleaseError && error.statusCode === AccountManager.ERROR_CONFLICT) {
        console.warn(chalk.yellow("[Warning] " + error.message));
    }
    else {
        throw error;
    }
}
function throwForInvalidEmail(email) {
    if (!emailValidator.validate(email)) {
        throw new Error('"' + email + '" is an invalid e-mail address.');
    }
}
function throwForInvalidSemverRange(semverRange) {
    if (semver.validRange(semverRange) === null) {
        throw new Error('Please use a semver-compliant target binary version range, for example "1.0.0", "*" or "^1.2.3".');
    }
}
function throwForInvalidOutputFormat(format) {
    switch (format) {
        case "json":
        case "table":
            break;
        default:
            throw new Error("Invalid format:  " + format + ".");
    }
}
function whoami(command) {
    return exports.sdk.getAccountInfo().then((account) => {
        const accountInfo = `${account.email} (${account.linkedProviders.join(", ")})`;
        (0, exports.log)(accountInfo);
    });
}
function isCommandOptionSpecified(option) {
    return option !== undefined && option !== null;
}
function getSdk(accessKey, headers, customServerUrl) {
    const sdk = new AccountManager(accessKey, CLI_HEADERS, customServerUrl);
    /*
     * If the server returns `Unauthorized`, it must be due to an invalid
     * (or expired) access key. For convenience, we patch every SDK call
     * to delete the cached connection so the user can simply
     * login again instead of having to log out first.
     */
    Object.getOwnPropertyNames(AccountManager.prototype).forEach((functionName) => {
        if (typeof sdk[functionName] === "function") {
            const originalFunction = sdk[functionName];
            sdk[functionName] = function () {
                let maybePromise = originalFunction.apply(sdk, arguments);
                if (maybePromise && maybePromise.then !== undefined) {
                    maybePromise = maybePromise.catch((error) => {
                        if (error.statusCode && error.statusCode === AccountManager.ERROR_UNAUTHORIZED) {
                            deleteConnectionInfoCache(/* printMessage */ false);
                        }
                        throw error;
                    });
                }
                return maybePromise;
            };
        }
    });
    return sdk;
}
