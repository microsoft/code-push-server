"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommand = exports.showHelp = void 0;
const yargs = require("yargs");
const cli = require("../script/types/cli");
const chalk = require("chalk");
const backslash = require("backslash");
const parseDuration = require("parse-duration");
const packageJson = require("../../package.json");
const ROLLOUT_PERCENTAGE_REGEX = /^(100|[1-9][0-9]|[1-9])%?$/;
const USAGE_PREFIX = "Usage: code-push-standalone";
// Command categories are:  access-key, app, release, deployment, deployment-key, login, logout, register
let isValidCommandCategory = false;
// Commands are the verb following the command category (e.g.:  "add" in "app add").
let isValidCommand = false;
let wasHelpShown = false;
function showHelp(showRootDescription) {
    if (!wasHelpShown) {
        if (showRootDescription) {
            console.log(chalk.cyan("  _____        __  " + chalk.green("  ___           __ ")));
            console.log(chalk.cyan(" / ___/__  ___/ /__" + chalk.green(" / _ \\__ _____ / / ")));
            console.log(chalk.cyan("/ /__/ _ \\/ _  / -_)" + chalk.green(" ___/ // (_-</ _ \\")));
            console.log(chalk.cyan("\\___/\\___/\\_,_/\\__/" + chalk.green("_/   \\_,_/___/_//_/")) + "    CLI v" + packageJson.version);
            console.log(chalk.cyan("======================================"));
            console.log("");
            console.log("CodePush is a service that enables you to deploy mobile app updates directly to your users' devices.\n");
        }
        yargs.showHelp();
        wasHelpShown = true;
    }
}
exports.showHelp = showHelp;
function accessKeyAdd(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " access-key " + commandName + " <accessKeyName>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("access-key " + commandName + ' "VSTS Integration"', 'Creates a new access key with the name "VSTS Integration", which expires in 60 days')
        .example("access-key " + commandName + ' "One time key" --ttl 5m', 'Creates a new access key with the name "One time key", which expires in 5 minutes')
        .option("ttl", {
        default: "60d",
        demand: false,
        description: "Duration string which specifies the amount of time that the access key should remain valid for (e.g 5m, 60d, 1y)",
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function accessKeyPatch(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " access-key " + commandName + " <accessKeyName>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("access-key " + commandName + ' "Key for build server" --name "Key for CI machine"', 'Renames the access key named "Key for build server" to "Key for CI machine"')
        .example("access-key " + commandName + ' "Key for build server" --ttl 7d', 'Updates the access key named "Key for build server" to expire in 7 days')
        .option("name", {
        default: null,
        demand: false,
        description: "Display name for the access key",
        type: "string",
    })
        .option("ttl", {
        default: null,
        demand: false,
        description: "Duration string which specifies the amount of time that the access key should remain valid for (e.g 5m, 60d, 1y)",
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function accessKeyList(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " access-key " + commandName + " [options]")
        .demand(/*count*/ 0, /*max*/ 0)
        .example("access-key " + commandName, "Lists your access keys in tabular format")
        .example("access-key " + commandName + " --format json", "Lists your access keys in JSON format")
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display your access keys with ("json" or "table")',
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function accessKeyRemove(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " access-key " + commandName + " <accessKeyName>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("access-key " + commandName + ' "VSTS Integration"', 'Removes the "VSTS Integration" access key');
    addCommonConfiguration(yargs);
}
function addCommonConfiguration(yargs) {
    yargs
        .wrap(/*columnLimit*/ null)
        .string("_") // Interpret non-hyphenated arguments as strings (e.g. an app version of '1.10').
        .fail((msg) => showHelp()); // Suppress the default error message.
}
function appList(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " app " + commandName + " [options]")
        .demand(/*count*/ 0, /*max*/ 0)
        .example("app " + commandName, "List your apps in tabular format")
        .example("app " + commandName + " --format json", "List your apps in JSON format")
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display your apps with ("json" or "table")',
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function appRemove(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " app " + commandName + " <appName>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("app " + commandName + " MyApp", 'Removes app "MyApp"');
    addCommonConfiguration(yargs);
}
function listCollaborators(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " collaborator " + commandName + " <appName> [options]")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("collaborator " + commandName + " MyApp", 'Lists the collaborators for app "MyApp" in tabular format')
        .example("collaborator " + commandName + " MyApp --format json", 'Lists the collaborators for app "MyApp" in JSON format')
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display collaborators with ("json" or "table")',
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function removeCollaborator(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " collaborator " + commandName + " <appName> <email>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("collaborator " + commandName + " MyApp foo@bar.com", 'Removes foo@bar.com as a collaborator from app "MyApp"');
    addCommonConfiguration(yargs);
}
function sessionList(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " session " + commandName + " [options]")
        .demand(/*count*/ 0, /*max*/ 0)
        .example("session " + commandName, "Lists your sessions in tabular format")
        .example("session " + commandName + " --format json", "Lists your login sessions in JSON format")
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display your login sessions with ("json" or "table")',
        type: "string",
    });
    addCommonConfiguration(yargs);
}
function sessionRemove(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " session " + commandName + " <machineName>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("session " + commandName + ' "John\'s PC"', 'Removes the existing login session from "John\'s PC"');
    addCommonConfiguration(yargs);
}
function deploymentHistoryClear(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " deployment " + commandName + " <appName> <deploymentName>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("deployment " + commandName + " MyApp MyDeployment", 'Clears the release history associated with deployment "MyDeployment" from app "MyApp"');
    addCommonConfiguration(yargs);
}
function deploymentList(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " deployment " + commandName + " <appName> [options]")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("deployment " + commandName + " MyApp", 'Lists the deployments for app "MyApp" in tabular format')
        .example("deployment " + commandName + " MyApp --format json", 'Lists the deployments for app "MyApp" in JSON format')
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display your deployments with ("json" or "table")',
        type: "string",
    })
        .option("displayKeys", {
        alias: "k",
        default: false,
        demand: false,
        description: "Specifies whether to display the deployment keys",
        type: "boolean",
    });
    addCommonConfiguration(yargs);
}
function deploymentRemove(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " deployment " + commandName + " <appName> <deploymentName>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("deployment " + commandName + " MyApp MyDeployment", 'Removes deployment "MyDeployment" from app "MyApp"');
    addCommonConfiguration(yargs);
}
function deploymentHistory(commandName, yargs) {
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " deployment " + commandName + " <appName> <deploymentName> [options]")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("deployment " + commandName + " MyApp MyDeployment", 'Displays the release history for deployment "MyDeployment" from app "MyApp" in tabular format')
        .example("deployment " + commandName + " MyApp MyDeployment --format json", 'Displays the release history for deployment "MyDeployment" from app "MyApp" in JSON format')
        .option("format", {
        default: "table",
        demand: false,
        description: 'Output format to display the release history with ("json" or "table")',
        type: "string",
    })
        .option("displayAuthor", {
        alias: "a",
        default: false,
        demand: false,
        description: "Specifies whether to display the release author",
        type: "boolean",
    });
    addCommonConfiguration(yargs);
}
yargs
    .usage(USAGE_PREFIX + " <command>")
    .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option argument.
    .command("access-key", "View and manage the access keys associated with your account", (yargs) => {
    isValidCommandCategory = true;
    yargs
        .usage(USAGE_PREFIX + " access-key <command>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments.
        .command("add", "Create a new access key associated with your account", (yargs) => accessKeyAdd("add", yargs))
        .command("patch", "Update the name and/or TTL of an existing access key", (yargs) => accessKeyPatch("patch", yargs))
        .command("remove", "Remove an existing access key", (yargs) => accessKeyRemove("remove", yargs))
        .command("rm", "Remove an existing access key", (yargs) => accessKeyRemove("rm", yargs))
        .command("list", "List the access keys associated with your account", (yargs) => accessKeyList("list", yargs))
        .command("ls", "List the access keys associated with your account", (yargs) => accessKeyList("ls", yargs))
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("app", "View and manage your CodePush apps", (yargs) => {
    isValidCommandCategory = true;
    yargs
        .usage(USAGE_PREFIX + " app <command>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments.
        .command("add", "Add a new app to your account", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " app add <appName>")
            .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
            .example("app add MyApp", 'Adds app "MyApp"');
        addCommonConfiguration(yargs);
    })
        .command("remove", "Remove an app from your account", (yargs) => appRemove("remove", yargs))
        .command("rm", "Remove an app from your account", (yargs) => appRemove("rm", yargs))
        .command("rename", "Rename an existing app", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " app rename <currentAppName> <newAppName>")
            .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
            .example("app rename CurrentName NewName", 'Renames app "CurrentName" to "NewName"');
        addCommonConfiguration(yargs);
    })
        .command("list", "Lists the apps associated with your account", (yargs) => appList("list", yargs))
        .command("ls", "Lists the apps associated with your account", (yargs) => appList("ls", yargs))
        .command("transfer", "Transfer the ownership of an app to another account", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " app transfer <appName> <email>")
            .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
            .example("app transfer MyApp foo@bar.com", 'Transfers the ownership of app "MyApp" to an account with email "foo@bar.com"');
        addCommonConfiguration(yargs);
    })
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("collaborator", "View and manage app collaborators", (yargs) => {
    isValidCommandCategory = true;
    yargs
        .usage(USAGE_PREFIX + " collaborator <command>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments.
        .command("add", "Add a new collaborator to an app", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " collaborator add <appName> <email>")
            .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
            .example("collaborator add MyApp foo@bar.com", 'Adds foo@bar.com as a collaborator to app "MyApp"');
        addCommonConfiguration(yargs);
    })
        .command("remove", "Remove a collaborator from an app", (yargs) => removeCollaborator("remove", yargs))
        .command("rm", "Remove a collaborator from an app", (yargs) => removeCollaborator("rm", yargs))
        .command("list", "List the collaborators for an app", (yargs) => listCollaborators("list", yargs))
        .command("ls", "List the collaborators for an app", (yargs) => listCollaborators("ls", yargs))
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("debug", "View the CodePush debug logs for a running app", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " debug <platform>")
        .demand(/*count*/ 1, /*max*/ 1) // Require exactly one non-option arguments
        .example("debug android", "View the CodePush debug logs for an Android emulator or device")
        .example("debug ios", "View the CodePush debug logs for the iOS simulator");
    addCommonConfiguration(yargs);
})
    .command("deployment", "View and manage your app deployments", (yargs) => {
    isValidCommandCategory = true;
    yargs
        .usage(USAGE_PREFIX + " deployment <command>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments.
        .command("add", "Add a new deployment to an app", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " deployment add <appName> <deploymentName>")
            .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
            .example("deployment add MyApp MyDeployment", 'Adds deployment "MyDeployment" to app "MyApp"')
            .example("deployment add MyApp MyDeployment -k abc123", 'Adds deployment key "abc123"')
            .option("key", {
            alias: "k",
            demand: false,
            description: "Specify deployment key",
            type: "string",
        });
        addCommonConfiguration(yargs);
    })
        .command("clear", "Clear the release history associated with a deployment", (yargs) => deploymentHistoryClear("clear", yargs))
        .command("remove", "Remove a deployment from an app", (yargs) => deploymentRemove("remove", yargs))
        .command("rm", "Remove a deployment from an app", (yargs) => deploymentRemove("rm", yargs))
        .command("rename", "Rename an existing deployment", (yargs) => {
        isValidCommand = true;
        yargs
            .usage(USAGE_PREFIX + " deployment rename <appName> <currentDeploymentName> <newDeploymentName>")
            .demand(/*count*/ 3, /*max*/ 3) // Require exactly three non-option arguments
            .example("deployment rename MyApp CurrentDeploymentName NewDeploymentName", 'Renames deployment "CurrentDeploymentName" to "NewDeploymentName"');
        addCommonConfiguration(yargs);
    })
        .command("list", "List the deployments associated with an app", (yargs) => deploymentList("list", yargs))
        .command("ls", "List the deployments associated with an app", (yargs) => deploymentList("ls", yargs))
        .command("history", "Display the release history for a deployment", (yargs) => deploymentHistory("history", yargs))
        .command("h", "Display the release history for a deployment", (yargs) => deploymentHistory("h", yargs))
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("link", "Link an additional authentication provider (e.g. GitHub) to an existing CodePush account", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " link")
        .demand(/*count*/ 0, /*max*/ 1) //set 'max' to one to allow usage of serverUrl undocument parameter for testing
        .example("link", "Links an account on the CodePush server")
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("login", "Authenticate with the CodePush server in order to begin managing your apps", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " login [options]")
        .demand(/*count*/ 0, /*max*/ 1) //set 'max' to one to allow usage of serverUrl undocument parameter for testing
        .example("login", "Logs in to the CodePush server")
        .example("login --accessKey mykey", 'Logs in on behalf of the user who owns and created the access key "mykey"')
        .option("accessKey", {
        alias: "key",
        default: null,
        demand: false,
        description: "Access key to authenticate against the CodePush server with, instead of providing your username and password credentials",
        type: "string",
    })
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("logout", "Log out of the current session", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " logout")
        .demand(/*count*/ 0, /*max*/ 0)
        .example("logout", "Logs out and ends your current session");
    addCommonConfiguration(yargs);
})
    .command("patch", "Update the metadata for an existing release", (yargs) => {
    yargs
        .usage(USAGE_PREFIX + " patch <appName> <deploymentName> [options]")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example('patch MyApp Production --des "Updated description" -r 50%', 'Updates the description of the latest release for "MyApp" app\'s "Production" deployment and updates the rollout value to 50%')
        .example('patch MyApp Production -l v3 --des "Updated description for v3"', 'Updates the description of the release with label v3 for "MyApp" app\'s "Production" deployment')
        .option("label", {
        alias: "l",
        default: null,
        demand: false,
        description: "Label of the release to update. Defaults to the latest release within the specified deployment",
        type: "string",
    })
        .option("description", {
        alias: "des",
        default: null,
        demand: false,
        description: "Description of the changes made to the app with this release",
        type: "string",
    })
        .option("disabled", {
        alias: "x",
        default: null,
        demand: false,
        description: "Specifies whether this release should be immediately downloadable",
        type: "boolean",
    })
        .option("mandatory", {
        alias: "m",
        default: null,
        demand: false,
        description: "Specifies whether this release should be considered mandatory",
        type: "boolean",
    })
        .option("rollout", {
        alias: "r",
        default: null,
        demand: false,
        description: "Percentage of users this release should be immediately available to. This attribute can only be increased from the current value.",
        type: "string",
    })
        .option("targetBinaryVersion", {
        alias: "t",
        default: null,
        demand: false,
        description: "Semver expression that specifies the binary app version(s) this release is targeting (e.g. 1.1.0, ~1.2.3).",
        type: "string",
    })
        .check((argv, aliases) => {
        return isValidRollout(argv);
    });
    addCommonConfiguration(yargs);
})
    .command("promote", "Promote the latest release from one app deployment to another", (yargs) => {
    yargs
        .usage(USAGE_PREFIX + " promote <appName> <sourceDeploymentName> <destDeploymentName> [options]")
        .demand(/*count*/ 3, /*max*/ 3) // Require exactly three non-option arguments
        .example("promote MyApp Staging Production", 'Promotes the latest release within the "Staging" deployment of "MyApp" to "Production"')
        .example('promote MyApp Staging Production --des "Production rollout" -r 25', 'Promotes the latest release within the "Staging" deployment of "MyApp" to "Production", with an updated description, and targeting only 25% of the users')
        .option("description", {
        alias: "des",
        default: null,
        demand: false,
        description: "Description of the changes made to the app with this release. If omitted, the description from the release being promoted will be used.",
        type: "string",
    })
        .option("label", {
        alias: "l",
        default: null,
        demand: false,
        description: "Label of the source release that will be taken. If omitted, the latest release being promoted will be used.",
        type: "string",
    })
        .option("disabled", {
        alias: "x",
        default: null,
        demand: false,
        description: "Specifies whether this release should be immediately downloadable. If omitted, the disabled attribute from the release being promoted will be used.",
        type: "boolean",
    })
        .option("mandatory", {
        alias: "m",
        default: null,
        demand: false,
        description: "Specifies whether this release should be considered mandatory. If omitted, the mandatory property from the release being promoted will be used.",
        type: "boolean",
    })
        .option("noDuplicateReleaseError", {
        default: false,
        demand: false,
        description: "When this flag is set, promoting a package that is identical to the latest release on the target deployment will produce a warning instead of an error",
        type: "boolean",
    })
        .option("rollout", {
        alias: "r",
        default: "100%",
        demand: false,
        description: "Percentage of users this update should be immediately available to",
        type: "string",
    })
        .option("targetBinaryVersion", {
        alias: "t",
        default: null,
        demand: false,
        description: "Semver expression that specifies the binary app version(s) this release is targeting (e.g. 1.1.0, ~1.2.3). If omitted, the target binary version property from the release being promoted will be used.",
        type: "string",
    })
        .check((argv, aliases) => {
        return isValidRollout(argv);
    });
    addCommonConfiguration(yargs);
})
    .command("register", "Register a new CodePush account", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " register")
        .demand(/*count*/ 0, /*max*/ 1) //set 'max' to one to allow usage of serverUrl undocument parameter for testing
        .example("register", "Registers a new CodePush account")
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("release", "Release an update to an app deployment", (yargs) => {
    yargs
        .usage(USAGE_PREFIX + " release <appName> <updateContentsPath> <targetBinaryVersion> [options]")
        .demand(/*count*/ 3, /*max*/ 3) // Require exactly three non-option arguments.
        .example('release MyApp app.js "*"', 'Releases the "app.js" file to the "MyApp" app\'s "Staging" deployment, targeting any binary version using the "*" wildcard range syntax.')
        .example("release MyApp ./platforms/ios/www 1.0.3 -d Production", 'Releases the "./platforms/ios/www" folder and all its contents to the "MyApp" app\'s "Production" deployment, targeting only the 1.0.3 binary version')
        .example("release MyApp ./platforms/ios/www 1.0.3 -d Production -r 20", 'Releases the "./platforms/ios/www" folder and all its contents to the "MyApp" app\'s "Production" deployment, targeting the 1.0.3 binary version and rolling out to about 20% of the users')
        .option("deploymentName", {
        alias: "d",
        default: "Staging",
        demand: false,
        description: "Deployment to release the update to",
        type: "string",
    })
        .option("description", {
        alias: "des",
        default: null,
        demand: false,
        description: "Description of the changes made to the app in this release",
        type: "string",
    })
        .option("disabled", {
        alias: "x",
        default: false,
        demand: false,
        description: "Specifies whether this release should be immediately downloadable",
        type: "boolean",
    })
        .option("mandatory", {
        alias: "m",
        default: false,
        demand: false,
        description: "Specifies whether this release should be considered mandatory",
        type: "boolean",
    })
        .option("noDuplicateReleaseError", {
        default: false,
        demand: false,
        description: "When this flag is set, releasing a package that is identical to the latest release will produce a warning instead of an error",
        type: "boolean",
    })
        .option("rollout", {
        alias: "r",
        default: "100%",
        demand: false,
        description: "Percentage of users this release should be available to",
        type: "string",
    })
        .check((argv, aliases) => {
        return checkValidReleaseOptions(argv);
    });
    addCommonConfiguration(yargs);
})
    .command("release-react", "Release a React Native update to an app deployment", (yargs) => {
    yargs
        .usage(USAGE_PREFIX + " release-react <appName> <platform> [options]")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("release-react MyApp ios", 'Releases the React Native iOS project in the current working directory to the "MyApp" app\'s "Staging" deployment')
        .example("release-react MyApp android -d Production", 'Releases the React Native Android project in the current working directory to the "MyApp" app\'s "Production" deployment')
        .example("release-react MyApp windows --dev", 'Releases the development bundle of the React Native Windows project in the current working directory to the "MyApp" app\'s "Staging" deployment')
        .option("bundleName", {
        alias: "b",
        default: null,
        demand: false,
        description: 'Name of the generated JS bundle file. If unspecified, the standard bundle name will be used, depending on the specified platform: "main.jsbundle" (iOS), "index.android.bundle" (Android) or "index.windows.bundle" (Windows)',
        type: "string",
    })
        .option("deploymentName", {
        alias: "d",
        default: "Staging",
        demand: false,
        description: "Deployment to release the update to",
        type: "string",
    })
        .option("description", {
        alias: "des",
        default: null,
        demand: false,
        description: "Description of the changes made to the app with this release",
        type: "string",
    })
        .option("development", {
        alias: "dev",
        default: false,
        demand: false,
        description: "Specifies whether to generate a dev or release build",
        type: "boolean",
    })
        .option("disabled", {
        alias: "x",
        default: false,
        demand: false,
        description: "Specifies whether this release should be immediately downloadable",
        type: "boolean",
    })
        .option("entryFile", {
        alias: "e",
        default: null,
        demand: false,
        description: 'Path to the app\'s entry Javascript file. If omitted, "index.<platform>.js" and then "index.js" will be used (if they exist)',
        type: "string",
    })
        .option("gradleFile", {
        alias: "g",
        default: null,
        demand: false,
        description: "Path to the gradle file which specifies the binary version you want to target this release at (android only).",
    })
        .option("mandatory", {
        alias: "m",
        default: false,
        demand: false,
        description: "Specifies whether this release should be considered mandatory",
        type: "boolean",
    })
        .option("noDuplicateReleaseError", {
        default: false,
        demand: false,
        description: "When this flag is set, releasing a package that is identical to the latest release will produce a warning instead of an error",
        type: "boolean",
    })
        .option("plistFile", {
        alias: "p",
        default: null,
        demand: false,
        description: "Path to the plist file which specifies the binary version you want to target this release at (iOS only).",
    })
        .option("plistFilePrefix", {
        alias: "pre",
        default: null,
        demand: false,
        description: "Prefix to append to the file name when attempting to find your app's Info.plist file (iOS only).",
    })
        .option("rollout", {
        alias: "r",
        default: "100%",
        demand: false,
        description: "Percentage of users this release should be immediately available to",
        type: "string",
    })
        .option("sourcemapOutput", {
        alias: "s",
        default: null,
        demand: false,
        description: "Path to where the sourcemap for the resulting bundle should be written. If omitted, a sourcemap will not be generated.",
        type: "string",
    })
        .option("targetBinaryVersion", {
        alias: "t",
        default: null,
        demand: false,
        description: 'Semver expression that specifies the binary app version(s) this release is targeting (e.g. 1.1.0, ~1.2.3). If omitted, the release will target the exact version specified in the "Info.plist" (iOS), "build.gradle" (Android) or "Package.appxmanifest" (Windows) files.',
        type: "string",
    })
        .option("outputDir", {
        alias: "o",
        default: null,
        demand: false,
        description: "Path to where the bundle and sourcemap should be written. If omitted, a bundle and sourcemap will not be written.",
        type: "string",
    })
        .option("useHermes", {
        alias: "h",
        default: false,
        demand: false,
        description: "Enable hermes and bypass automatic checks",
        type: "boolean",
    })
        .option("podFile", {
        alias: "pod",
        default: null,
        demand: false,
        description: "Path to the cocopods config file (iOS only).",
        type: "string",
    })
        .option("extraHermesFlags", {
        alias: "hf",
        default: [],
        demand: false,
        description: "Flags that get passed to Hermes, JavaScript to bytecode compiler. Can be specified multiple times.",
        type: "array",
    })
        .option("privateKeyPath", {
        alias: "k",
        default: null,
        demand: false,
        description: "Path to private key used for code signing.",
        type: "string",
    })
        .option("xcodeProjectFile", {
        alias: "xp",
        default: null,
        demand: false,
        description: "Path to the Xcode project or project.pbxproj file",
        type: "string",
    })
        .option("xcodeTargetName", {
        alias: "xt",
        default: undefined,
        demand: false,
        description: "Name of target (PBXNativeTarget) which specifies the binary version you want to target this release at (iOS only)",
        type: "string",
    })
        .option("buildConfigurationName", {
        alias: "c",
        default: undefined,
        demand: false,
        description: "Name of build configuration which specifies the binary version you want to target this release at. For example, 'Debug' or 'Release' (iOS only)",
        type: "string",
    })
        .check((argv, aliases) => {
        return checkValidReleaseOptions(argv);
    });
    addCommonConfiguration(yargs);
})
    .command("rollback", "Rollback the latest release for an app deployment", (yargs) => {
    yargs
        .usage(USAGE_PREFIX + " rollback <appName> <deploymentName> [options]")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments
        .example("rollback MyApp Production", 'Performs a rollback on the "Production" deployment of "MyApp"')
        .example("rollback MyApp Production --targetRelease v4", 'Performs a rollback on the "Production" deployment of "MyApp" to the v4 release')
        .option("targetRelease", {
        alias: "r",
        default: null,
        demand: false,
        description: "Label of the release to roll the specified deployment back to (e.g. v4). If omitted, the deployment will roll back to the previous release.",
        type: "string",
    });
    addCommonConfiguration(yargs);
})
    .command("session", "View and manage the current login sessions associated with your account", (yargs) => {
    isValidCommandCategory = true;
    yargs
        .usage(USAGE_PREFIX + " session <command>")
        .demand(/*count*/ 2, /*max*/ 2) // Require exactly two non-option arguments.
        .command("remove", "Remove an existing login session", (yargs) => sessionRemove("remove", yargs))
        .command("rm", "Remove an existing login session", (yargs) => sessionRemove("rm", yargs))
        .command("list", "List the current login sessions associated with your account", (yargs) => sessionList("list", yargs))
        .command("ls", "List the current login sessions associated with your account", (yargs) => sessionList("ls", yargs))
        .check((argv, aliases) => isValidCommand); // Report unrecognized, non-hyphenated command category.
    addCommonConfiguration(yargs);
})
    .command("whoami", "Display the account info for the current login session", (yargs) => {
    isValidCommandCategory = true;
    isValidCommand = true;
    yargs
        .usage(USAGE_PREFIX + " whoami")
        .demand(/*count*/ 0, /*max*/ 0)
        .example("whoami", "Display the account info for the current login session");
    addCommonConfiguration(yargs);
})
    .alias("v", "version")
    .version(packageJson.version)
    .wrap(/*columnLimit*/ null)
    .fail((msg) => showHelp(/*showRootDescription*/ true)).argv; // Suppress the default error message.
function createCommand() {
    let cmd;
    const argv = yargs.parseSync();
    if (!wasHelpShown && argv._ && argv._.length > 0) {
        // Create a command object
        const arg0 = argv._[0];
        const arg1 = argv._[1];
        const arg2 = argv._[2];
        const arg3 = argv._[3];
        const arg4 = argv._[4];
        switch (arg0) {
            case "access-key":
                switch (arg1) {
                    case "add":
                        if (arg2) {
                            cmd = { type: cli.CommandType.accessKeyAdd };
                            const accessKeyAddCmd = cmd;
                            accessKeyAddCmd.name = arg2;
                            const ttlOption = argv["ttl"];
                            if (isDefined(ttlOption)) {
                                accessKeyAddCmd.ttl = parseDurationMilliseconds(ttlOption);
                            }
                        }
                        break;
                    case "patch":
                        if (arg2) {
                            cmd = { type: cli.CommandType.accessKeyPatch };
                            const accessKeyPatchCmd = cmd;
                            accessKeyPatchCmd.oldName = arg2;
                            const newNameOption = argv["name"];
                            const ttlOption = argv["ttl"];
                            if (isDefined(newNameOption)) {
                                accessKeyPatchCmd.newName = newNameOption;
                            }
                            if (isDefined(ttlOption)) {
                                accessKeyPatchCmd.ttl = parseDurationMilliseconds(ttlOption);
                            }
                        }
                        break;
                    case "list":
                    case "ls":
                        cmd = { type: cli.CommandType.accessKeyList };
                        cmd.format = argv["format"];
                        break;
                    case "remove":
                    case "rm":
                        if (arg2) {
                            cmd = { type: cli.CommandType.accessKeyRemove };
                            cmd.accessKey = arg2;
                        }
                        break;
                }
                break;
            case "app":
                switch (arg1) {
                    case "add":
                        if (arg2) {
                            cmd = { type: cli.CommandType.appAdd };
                            cmd.appName = arg2;
                        }
                        break;
                    case "list":
                    case "ls":
                        cmd = { type: cli.CommandType.appList };
                        cmd.format = argv["format"];
                        break;
                    case "remove":
                    case "rm":
                        if (arg2) {
                            cmd = { type: cli.CommandType.appRemove };
                            cmd.appName = arg2;
                        }
                        break;
                    case "rename":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.appRename };
                            const appRenameCommand = cmd;
                            appRenameCommand.currentAppName = arg2;
                            appRenameCommand.newAppName = arg3;
                        }
                        break;
                    case "transfer":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.appTransfer };
                            const appTransferCommand = cmd;
                            appTransferCommand.appName = arg2;
                            appTransferCommand.email = arg3;
                        }
                        break;
                }
                break;
            case "collaborator":
                switch (arg1) {
                    case "add":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.collaboratorAdd };
                            cmd.appName = arg2;
                            cmd.email = arg3;
                        }
                        break;
                    case "list":
                    case "ls":
                        if (arg2) {
                            cmd = { type: cli.CommandType.collaboratorList };
                            cmd.appName = arg2;
                            cmd.format = argv["format"];
                        }
                        break;
                    case "remove":
                    case "rm":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.collaboratorRemove };
                            cmd.appName = arg2;
                            cmd.email = arg3;
                        }
                        break;
                }
                break;
            case "debug":
                cmd = {
                    type: cli.CommandType.debug,
                    platform: arg1,
                };
                break;
            case "deployment":
                switch (arg1) {
                    case "add":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.deploymentAdd };
                            const deploymentAddCommand = cmd;
                            deploymentAddCommand.appName = arg2;
                            deploymentAddCommand.deploymentName = arg3;
                            if (argv["key"]) {
                                deploymentAddCommand.key = argv["key"];
                            }
                        }
                        break;
                    case "clear":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.deploymentHistoryClear };
                            const deploymentHistoryClearCommand = cmd;
                            deploymentHistoryClearCommand.appName = arg2;
                            deploymentHistoryClearCommand.deploymentName = arg3;
                        }
                        break;
                    case "list":
                    case "ls":
                        if (arg2) {
                            cmd = { type: cli.CommandType.deploymentList };
                            const deploymentListCommand = cmd;
                            deploymentListCommand.appName = arg2;
                            deploymentListCommand.format = argv["format"];
                            deploymentListCommand.displayKeys = argv["displayKeys"];
                        }
                        break;
                    case "remove":
                    case "rm":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.deploymentRemove };
                            const deploymentRemoveCommand = cmd;
                            deploymentRemoveCommand.appName = arg2;
                            deploymentRemoveCommand.deploymentName = arg3;
                        }
                        break;
                    case "rename":
                        if (arg2 && arg3 && arg4) {
                            cmd = { type: cli.CommandType.deploymentRename };
                            const deploymentRenameCommand = cmd;
                            deploymentRenameCommand.appName = arg2;
                            deploymentRenameCommand.currentDeploymentName = arg3;
                            deploymentRenameCommand.newDeploymentName = arg4;
                        }
                        break;
                    case "history":
                    case "h":
                        if (arg2 && arg3) {
                            cmd = { type: cli.CommandType.deploymentHistory };
                            const deploymentHistoryCommand = cmd;
                            deploymentHistoryCommand.appName = arg2;
                            deploymentHistoryCommand.deploymentName = arg3;
                            deploymentHistoryCommand.format = argv["format"];
                            deploymentHistoryCommand.displayAuthor = argv["displayAuthor"];
                        }
                        break;
                }
                break;
            case "link":
                cmd = {
                    type: cli.CommandType.link,
                    serverUrl: getServerUrl(arg1),
                };
                break;
            case "login":
                cmd = { type: cli.CommandType.login };
                const loginCommand = cmd;
                loginCommand.serverUrl = getServerUrl(arg1);
                loginCommand.accessKey = argv["accessKey"];
                break;
            case "logout":
                cmd = { type: cli.CommandType.logout };
                break;
            case "patch":
                if (arg1 && arg2) {
                    cmd = { type: cli.CommandType.patch };
                    const patchCommand = cmd;
                    patchCommand.appName = arg1;
                    patchCommand.deploymentName = arg2;
                    patchCommand.label = argv["label"];
                    // Description must be set to null to indicate that it is not being patched.
                    patchCommand.description = argv["description"] ? backslash(argv["description"]) : null;
                    patchCommand.disabled = argv["disabled"];
                    patchCommand.mandatory = argv["mandatory"];
                    patchCommand.rollout = getRolloutValue(argv["rollout"]);
                    patchCommand.appStoreVersion = argv["targetBinaryVersion"];
                }
                break;
            case "promote":
                if (arg1 && arg2 && arg3) {
                    cmd = { type: cli.CommandType.promote };
                    const deploymentPromoteCommand = cmd;
                    deploymentPromoteCommand.appName = arg1;
                    deploymentPromoteCommand.sourceDeploymentName = arg2;
                    deploymentPromoteCommand.destDeploymentName = arg3;
                    deploymentPromoteCommand.description = argv["description"] ? backslash(argv["description"]) : "";
                    deploymentPromoteCommand.label = argv["label"];
                    deploymentPromoteCommand.disabled = argv["disabled"];
                    deploymentPromoteCommand.mandatory = argv["mandatory"];
                    deploymentPromoteCommand.noDuplicateReleaseError = argv["noDuplicateReleaseError"];
                    deploymentPromoteCommand.rollout = getRolloutValue(argv["rollout"]);
                    deploymentPromoteCommand.appStoreVersion = argv["targetBinaryVersion"];
                }
                break;
            case "register":
                cmd = { type: cli.CommandType.register };
                const registerCommand = cmd;
                registerCommand.serverUrl = getServerUrl(arg1);
                break;
            case "release":
                if (arg1 && arg2 && arg3) {
                    cmd = { type: cli.CommandType.release };
                    const releaseCommand = cmd;
                    releaseCommand.appName = arg1;
                    releaseCommand.package = arg2;
                    releaseCommand.appStoreVersion = arg3;
                    releaseCommand.deploymentName = argv["deploymentName"];
                    releaseCommand.description = argv["description"] ? backslash(argv["description"]) : "";
                    releaseCommand.disabled = argv["disabled"];
                    releaseCommand.mandatory = argv["mandatory"];
                    releaseCommand.noDuplicateReleaseError = argv["noDuplicateReleaseError"];
                    releaseCommand.rollout = getRolloutValue(argv["rollout"]);
                }
                break;
            case "release-react":
                if (arg1 && arg2) {
                    cmd = { type: cli.CommandType.releaseReact };
                    const releaseReactCommand = cmd;
                    releaseReactCommand.appName = arg1;
                    releaseReactCommand.platform = arg2;
                    releaseReactCommand.appStoreVersion = argv["targetBinaryVersion"];
                    releaseReactCommand.bundleName = argv["bundleName"];
                    releaseReactCommand.deploymentName = argv["deploymentName"];
                    releaseReactCommand.disabled = argv["disabled"];
                    releaseReactCommand.description = argv["description"] ? backslash(argv["description"]) : "";
                    releaseReactCommand.development = argv["development"];
                    releaseReactCommand.entryFile = argv["entryFile"];
                    releaseReactCommand.gradleFile = argv["gradleFile"];
                    releaseReactCommand.mandatory = argv["mandatory"];
                    releaseReactCommand.noDuplicateReleaseError = argv["noDuplicateReleaseError"];
                    releaseReactCommand.plistFile = argv["plistFile"];
                    releaseReactCommand.plistFilePrefix = argv["plistFilePrefix"];
                    releaseReactCommand.rollout = getRolloutValue(argv["rollout"]);
                    releaseReactCommand.sourcemapOutput = argv["sourcemapOutput"];
                    releaseReactCommand.outputDir = argv["outputDir"];
                    releaseReactCommand.useHermes = argv["useHermes"];
                    releaseReactCommand.extraHermesFlags = argv["extraHermesFlags"];
                    releaseReactCommand.podFile = argv["podFile"];
                    releaseReactCommand.privateKeyPath = argv["privateKeyPath"];
                    releaseReactCommand.xcodeProjectFile = argv["xcodeProjectFile"];
                    releaseReactCommand.xcodeTargetName = argv["xcodeTargetName"];
                    releaseReactCommand.buildConfigurationName = argv["buildConfigurationName"];
                }
                break;
            case "rollback":
                if (arg1 && arg2) {
                    cmd = { type: cli.CommandType.rollback };
                    const rollbackCommand = cmd;
                    rollbackCommand.appName = arg1;
                    rollbackCommand.deploymentName = arg2;
                    rollbackCommand.targetRelease = argv["targetRelease"];
                }
                break;
            case "session":
                switch (arg1) {
                    case "list":
                    case "ls":
                        cmd = { type: cli.CommandType.sessionList };
                        cmd.format = argv["format"];
                        break;
                    case "remove":
                    case "rm":
                        if (arg2) {
                            cmd = { type: cli.CommandType.sessionRemove };
                            cmd.machineName = arg2;
                        }
                        break;
                }
                break;
            case "whoami":
                cmd = { type: cli.CommandType.whoami };
                break;
        }
        return cmd;
    }
}
exports.createCommand = createCommand;
function isValidRollout(args) {
    const rollout = args["rollout"];
    if (rollout && !ROLLOUT_PERCENTAGE_REGEX.test(rollout)) {
        return false;
    }
    return true;
}
function checkValidReleaseOptions(args) {
    return isValidRollout(args) && !!args["deploymentName"];
}
function getRolloutValue(input) {
    return input ? parseInt(input.replace("%", "")) : null;
}
function getServerUrl(url) {
    if (!url)
        return null;
    // Trim whitespace and a trailing slash (/) character.
    url = url.trim();
    if (url[url.length - 1] === "/") {
        url = url.substring(0, url.length - 1);
    }
    url = url.replace(/^(https?):\\/, "$1://"); // Replace 'http(s):\' with 'http(s)://' for Windows Git Bash
    return url;
}
function isDefined(object) {
    return object !== undefined && object !== null;
}
function parseDurationMilliseconds(durationString) {
    return Math.floor(parseDuration(durationString));
}
