# CodePush CLI

The CodePush CLI is a Node.js application that allows users to interact with CodePush Server.

## Installation

To run the CodePush CLI, follow these steps:

1. Clone the CodePush Service repository.
1. Install the necessary dependencies by running `npm install`.
1. Build the CLI by running `npm run build`.
1. Install CLI globally by running `npm install -g`.

## Getting started

1. Create a [CodePush account](#account-creation) push using the CodePush CLI.
1. Register your app with CodePush, and optionally share it with other developers on your team.
1. CodePush-ify your app and point it at the deployment you wish to use.
1. Release an update for your app.
1. Check out the debug logs to ensure everything is working as expected.

## Usage

After installing CodePush CLI globally, it will be available under `code-push-standalone`.

## Account Management

Before you can begin releasing app updates, you need to create a CodePush account. You can do this by simply running the following command once you've installed the CLI:

```
code-push-standalone register <optional: server-url>
```

This will launch a browser, asking you to authenticate with either your GitHub or Microsoft account. Once authenticated, it will create a CodePush account "linked" to your GitHub/MSA identity, and generate an access key you can copy/paste into the CLI in order to login.

_Note: After registering, you are automatically logged-in with the CLI, so until you explicitly log out, you don't need to login again from the same machine._

If you have an existing account, you may also link your account to another identity provider (e.g. Microsoft, GitHub) by running:

```
code-push-standalone link
```

_Note: In order to link multiple accounts, the email address associated with each provider must match._

### Authentication

Most commands within the CodePush CLI require authentication, and therefore, before you can begin managing your account, you need to login using the GitHub or Microsoft account you used when registering. You can do this by running the following command:

```shell
code-push-standalone login <optional: server-url>
```

This will launch a browser, asking you to authenticate with either your GitHub or Microsoft account. This will generate an access key that you need to copy/paste into the CLI (it will prompt you for it). You are now successfully authenticated and can safely close your browser window.

If at any time you want to determine if you're already logged in, you can run the following command to display the e-mail address associated with your current authentication session, which identity providers your account is linked to (e.g. GitHub):

```shell
code-push-standalone whoami
```

When you login from the CLI, your access key is persisted to disk for the duration of your session so that you don't have to login every time you attempt to access your account. In order to end your session and delete this access key, simply run the following command:

```shell
code-push-standalone logout
```

If you forget to logout from a machine you'd prefer not to leave a running session on (e.g. your friend's laptop), you can use the following commands to list and remove any current login sessions.

```shell
code-push-standalone session ls
code-push-standalone session rm <machineName>
```

### Access Keys

If you need to be able to authenticate against the CodePush service without launching a browser and/or without needing to use your GitHub and/or Microsoft credentials (e.g. in a CI environment), you can run the following command to create an "access key" (along with a name describing what it is for):

```shell
code-push-standalone access-key add "VSTS Integration"
```

By default, access keys expire in 60 days. You can specify a different expiry duration by using the `--ttl` option and passing in a [human readable duration string](https://github.com/jkroso/parse-duration#parsestr) (e.g. "2d" => 2 days, "1h 15 min" => 1 hour and 15 minutes). For security, the key will only be shown once on creation, so remember to save it somewhere if needed!

After creating the new key, you can specify its value using the `--accessKey` flag of the `login` command, which allows you to perform "headless" authentication, as opposed to launching a browser.

```shell
code-push-standalone login --accessKey <accessKey>
```

When logging in via this method, the access key will not be automatically invalidated on logout, and can be used in future sessions until it is explicitly removed from the CodePush server or expires. However, it is still recommended that you log out once your session is complete, in order to remove your credentials from disk.

Finally, if at any point you need to change a key's name and/or expiration date, you can use the following command:

```shell
code-push-standalone access-key patch <accessKeyName> --name "new name" --ttl 10d
```

_NOTE: When patching the TTL of an existing access key, its expiration date will be set relative to the current time, with no regard for its previous value._

## App Management

Before you can deploy any updates, you need to register an app with the CodePush service using the following command:

```
code-push-standalone app add <appName>
```

If your app targets both iOS and Android, please _create separate apps for each platform_ with CodePush (see the note below for details). This way, you can manage and release updates to them separately, which in the long run, also tends to make things simpler. The naming convention that most folks use is to suffix the app name with `-iOS` and `-Android`. For example:

```
code-push-standalone app add MyApp-Android
code-push-standalone app add MyApp-iOS
```

_NOTE: Using the same app for iOS and Android may cause installation exceptions because the CodePush update package produced for iOS will have different content from the update produced for Android._

All new apps automatically come with two deployments (`Staging` and `Production`) so that you can begin distributing updates to multiple channels without needing to do anything extra (see deployment instructions below). After you create an app, the CLI will output the deployment keys for the `Staging` and `Production` deployments, which you can begin using to configure your mobile clients with the [React Native](http://github.com/Microsoft/react-native-code-push) SDK.

If you decide that you don't like the name you gave to an app, you can rename it at any time using the following command:

```
code-push-standalone app rename <appName> <newAppName>
```

The app's name is only meant to be recognizable from the management side, and therefore, you can feel free to rename it as necessary. It won't actually impact the running app, since update queries are made via deployment keys.

If at some point you no longer need an app, you can remove it from the server using the following command:

```
code-push-standalone app rm <appName>
```

Do this with caution since any apps that have been configured to use it will obviously stop receiving updates.

Finally, if you want to list all apps that you've registered with the CodePush server,
you can run the following command:

```
code-push-standalone app ls
```

### App Collaboration

If you will be working with other developers on the same CodePush app, you can add them as collaborators using the following command:

```shell
code-push-standalone collaborator add <appName> <collaboratorEmail>
```

_NOTE: This expects the developer to have already [registered](#account-creation) with CodePush using the specified e-mail address, so ensure that they have done that before attempting to share the app with them._

Once added, all collaborators will immediately have the following permissions with regards to the newly shared app:

1. View the app, its collaborators, [deployments](#deployment-management) and [release history](#viewing-release-history)
1. [Release](#releasing-updates) updates to any of the app's deployments
1. [Promote](#promoting-updates) an update between any of the app's deployments
1. [Rollback](#rolling-back-undesired-updates) any of the app's deployments
1. [Patch](#updating-existing-releases) any releases within any of the app's deployments

Inversely, that means that an app collaborator cannot do any of the following:

1. Rename or delete the app
1. Transfer ownership of the app
1. Create, rename or delete new deployments within the app
1. Clear a deployment's release history
1. Add or remove collaborators from the app (\*)

_NOTE: A developer can remove him/herself as a collaborator from an app that was shared with them._

Over time, if someone is no longer working on an app with you, you can remove them as a collaborator using the following command:

```shell
code-push-standalone collaborator rm <appName> <collaboratorEmail>
```

If at any time you want to list all collaborators that have been added to an app, you can simply run the following command:

```shell
code-push-standalone collaborator ls <appName>
```

Finally, if at some point, you (as the app owner) will no longer be working on the app, and you want to transfer it to another developer (or a client), you can run the following command:

```shell
code-push-standalone app transfer <appName> <newOwnerEmail>
```

_NOTE: Just like with the `code-push-standalone collaborator add` command, this expects that the new owner has already registered with CodePush using the specified e-mail address._

Once confirmed, the specified developer becomes the app's owner and immediately receives the permissions associated with that role. Besides the transfer of ownership, nothing else about the app is modified (e.g. deployments, release history, collaborators). This means that you will still be a collaborator of the app, and therefore, if you want to remove yourself, you simply need to run the `code-push-standalone collaborator rm` command after successfully transferring ownership.

### Deployment Management

From the CodePush perspective, an app is simply a named grouping for one or more things called "deployments". While the app represents a conceptual "namespace" or "scope" for a platform-specific version of an app (e.g. the iOS port of Foo app), its deployments represent the actual target for releasing updates (for developers) and synchronizing updates (for end-users). Deployments allow you to have multiple "environments" for each app in-flight at any given time, and help model the reality that apps typically move from a dev's personal environment to a testing/QA/staging environment, before finally making their way into production.

_NOTE: As you'll see below, the `release`, `promote` and `rollback` commands require both an app name and a deployment name is order to work, because it is the combination of the two that uniquely identifies a point of distribution (e.g. I want to release an update of my iOS app to my beta testers)._

Whenever an app is registered with the CodePush service, it includes two deployments by default: `Staging` and `Production`. This allows you to immediately begin releasing updates to an internal environment, where you can thoroughly test each update before pushing them out to your end-users. This workflow is critical for ensuring your releases are ready for mass-consumption, and is a practice that has been established in the web for a long time.

If having a staging and production version of your app is enough to meet your needs, then you don't need to do anything else. However, if you want an alpha, dev, etc. deployment, you can easily create them using the following command:

```
code-push-standalone deployment add <appName> <deploymentName>
```

If you want to re-use an existing deployment key, you can do this with:

```
code-push-standalone deployment add <appName> <deploymentName> -k <existing-deployment-key>
```

Just like with apps, you can remove and rename deployments as well, using the following commands respectively:

```
code-push-standalone deployment rm <appName> <deploymentName>
code-push-standalone deployment rename <appName> <deploymentName> <newDeploymentName>
```

If at any time you'd like to view the list of deployments that a specific app includes, you can simply run the following command:

```
code-push-standalone deployment ls <appName> [--displayKeys|-k]
```

This will display not only the list of deployments, but also the update metadata (e.g. mandatory, description) and installation metrics for their latest release:

![Deployment list](https://cloud.githubusercontent.com/assets/116461/12526883/7730991c-c127-11e5-9196-98e9ceec758f.png)

_NOTE: Due to their infrequent use and needed screen real estate, deployment keys aren't displayed by default. If you need to view them, simply make sure to pass the `-k` flag to the `deployment ls` command._

The install metrics have the following meaning:

- **Active** - The number of successful installs that are currently running this release (i.e. if the user opened your app, they would see/run this version). This number will increase and decrease as end-users upgrade to and away from this release, respectively. This metric shows both the total of active users, as well as what percentage of your overall audience that represents. This makes it easy to determine the distribution of updates that your users are currently running, as well as answer questions such as "How many of my users have received my latest update?".

- **Total** - The total number of successful installations that this update has received overall. This number only ever increases as new users/devices install it, and therefore, this is always a superset of the total active count. An update is considered successful once `notifyApplicationReady` (or `sync`) is called after it was installed. Between the moment that an update is downloaded, and it is marked as being successful, it will be reported as a "pending" update (see below for details).

- **Pending** - The number of times this release has been downloaded, but not yet installed (i.e. the app was restarted to apply the changes). Therefore, this metric increases as updates are downloaded, and decreases as those corresponding downloaded updates are installed. This metric primarily applies to updates that aren't configured to install immediately, and helps provide the broader picture of release adoption for apps that rely on app resume and/or restart to apply an update (e.g. I want to rollback an update and I'm curious if anyone has downloaded it yet). If you've configured updates to install immediately, and are still seeing pending updates being reported, then it's likely that you're not calling `notifyApplicationReady` (or `sync`) on app start, which is the method that initiates sending install reports and marks installed updates as being considered successful.

- **Rollbacks** - The number of times that this release has been automatically rolled back on the client. Ideally this number should be zero, and in that case, this metric isn't even shown. However, if you released an update that includes a crash as part of the installation process, the CodePush plugin will roll the end-user back to the previous release, and report that issue back to the server. This allows your end-users to remain unblocked in the event of broken releases, and by being able to see this telemetry in the CLI, you can identify erroneous releases and respond to them by [rolling it back](#rolling-back-undesired-updates) on the server.

- **Rollout** - Indicates the percentage of users that are eligible to receive this update. This property will only be displayed for releases that represent an "active" rollout, and therefore, have a rollout percentage that is less than 100%. Additionally, since a deployment can only have one active rollout at any given time, this label would only be present on the latest release within a deployment.

- **Disabled** - Indicates whether the release has been marked as disabled or not, and therefore, is downloadable by end users. This property will only be displayed for releases that are actually disabled.

When the metrics cell reports `No installs recorded`, that indicates that the server hasn't seen any activity for this release. This could either be because it precluded the plugin versions that included telemetry support, or no end-users have synchronized with the CodePush server yet. As soon as an install happens, you will begin to see metrics populate in the CLI for the release.

## Releasing Updates

Once your app has been configured to query for updates against the CodePush server, you can begin releasing updates to it. In order to provide both simplicity and flexibility, the CodePush CLI includes two different commands for releasing updates:

1. [General](#releasing-updates-general) - Releases an update to the CodePush server that was generated by an external tool or build script (e.g. a Gulp task, the `react-native bundle` command). This provides the most flexibility in terms of fitting into existing workflows, since it strictly deals with CodePush-specific step, and leaves the app-specific compilation process to you.

2. [React Native](#releasing-updates-react-native) - Performs the same functionality as the general release command, but also handles the task of generating the updated app contents for you (JS bundle and assets), instead of requiring you to run both `react-native bundle` and then `code-push-standalone release`.

Which of these commands you should use is mostly a matter of requirements and/or preference. However, we generally recommend using the platform-specific command to start (since it greatly simplifies the experience), and then leverage the general-purpose `release` command if/when greater control is needed.

### Releasing Updates (General)

```
code-push-standalone release <appName> <updateContents> <targetBinaryVersion>
[--deploymentName <deploymentName>]
[--description <description>]
[--disabled <disabled>]
[--mandatory]
[--noDuplicateReleaseError]
[--rollout <rolloutPercentage>]
```

#### App name parameter

This specifies the name of the CodePush app that this update is being released for. This value corresponds to the friendly name that you specified when originally calling `code-push-standalone app add` (e.g. "MyApp-Android"). If you need to look it up, you can run the `code-push-standalone app ls` command to see your list of apps.

#### Update contents parameter

This specifies the location of the updated app code and assets you want to release. You can provide either a single file (e.g. a JS bundle for a React Native app), or a path to a directory. Note that you don't need to ZIP up multiple files or directories in order to deploy those changes, since the CLI will automatically ZIP them for you.

It's important that the path you specify refers to the platform-specific, prepared/bundled version of your app. The following table outlines which command you should run before releasing, as well as the location you can subsequently refer to using the `updateContents` parameter:

| Platform                         | Prepare command                                                                                                                                            | Package path (relative to project root)                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| React Native wo/assets (Android) | `react-native bundle --platform android --entry-file <entryFile> --bundle-output <bundleOutput> --dev false`                                               | Value of the `--bundle-output` option                                                                                         |
| React Native w/assets (Android)  | `react-native bundle --platform android --entry-file <entryFile> --bundle-output <releaseFolder>/<bundleOutput> --assets-dest <releaseFolder> --dev false` | Value of the `--assets-dest` option, which should represent a newly created directory that includes your assets and JS bundle |
| React Native wo/assets (iOS)     | `react-native bundle --platform ios --entry-file <entryFile> --bundle-output <bundleOutput> --dev false`                                                   | Value of the `--bundle-output` option                                                                                         |
| React Native w/assets (iOS)      | `react-native bundle --platform ios --entry-file <entryFile> --bundle-output <releaseFolder>/<bundleOutput> --assets-dest <releaseFolder> --dev false`     | Value of the `--assets-dest` option, which should represent a newly created directory that includes your assets and JS bundle |

#### Target binary version parameter

This specifies the store/binary version of the application you are releasing the update for, so that only users running that version will receive the update, while users running an older and/or newer version of the app binary will not. This is useful for the following reasons:

1. If a user is running an older binary version, it's possible that there are breaking changes in the CodePush update that wouldn't be compatible with what they're running.

2. If a user is running a newer binary version, then it's presumed that what they are running is newer (and potentially incompatible) with the CodePush update.

If you ever want an update to target multiple versions of the app store binary, we also allow you to specify the parameter as a [semver range expression](https://github.com/npm/node-semver#advanced-range-syntax). That way, any client device running a version of the binary that satisfies the range expression (i.e. `semver.satisfies(version, range)` returns `true`) will get the update. Examples of valid semver range expressions are as follows:

| Range Expression | Who gets the update                                                                    |
| ---------------- | -------------------------------------------------------------------------------------- |
| `1.2.3`          | Only devices running the specific binary app store version `1.2.3` of your app         |
| `*`              | Any device configured to consume updates from your CodePush app                        |
| `1.2.x`          | Devices running major version 1, minor version 2 and any patch version of your app     |
| `1.2.3 - 1.2.7`  | Devices running any binary version between `1.2.3` (inclusive) and `1.2.7` (inclusive) |
| `>=1.2.3 <1.2.7` | Devices running any binary version between `1.2.3` (inclusive) and `1.2.7` (exclusive) |
| `~1.2.3`         | Equivalent to `>=1.2.3 <1.3.0`                                                         |
| `^1.2.3`         | Equivalent to `>=1.2.3 <2.0.0`                                                         |

_NOTE: If your semver expression starts with a special shell character or operator such as `>`, `^`, or \*\*
_, the command may not execute correctly if you do not wrap the value in quotes as the shell will not supply the right values to our CLI process. Therefore, it is best to wrap your `targetBinaryVersion` parameter in double quotes when calling the `release` command, e.g. `code-push-standalone release MyApp-iOS updateContents ">1.2.3"`.\*

_NOTE: As defined in the semver spec, ranges only work for non pre-release versions: https://github.com/npm/node-semver#prerelease-tags. If you want to update a version with pre-release tags, then you need to write the exact version you want to update (`1.2.3-beta` for example)._

The following table outlines the version value that CodePush expects your update's semver range to satisfy for each respective app type:

| Platform               | Source of app store version                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| React Native (Android) | The `android.defaultConfig.versionName` property in your `build.gradle` file |
| React Native (iOS)     | The `CFBundleShortVersionString` key in the `Info.plist` file                |
| React Native (Windows) | The `<Identity Version>` key in the `Package.appxmanifest` file              |

_NOTE: If the app store version in the metadata files are missing a patch version, e.g. `2.0`, it will be treated as having a patch version of `0`, i.e. `2.0 -> 2.0.0`._

#### Deployment name parameter

This specifies which deployment you want to release the update to. This defaults to `Staging`, but when you're ready to deploy to `Production`, or one of your own custom deployments, just explicitly set this argument.

_NOTE: The parameter can be set using either "--deploymentName" or "-d"._

#### Description parameter

This provides an optional "change log" for the deployment. The value is simply round tripped to the client so that when the update is detected, your app can choose to display it to the end-user (e.g. via a "What's new?" dialog). This string accepts control characters such as `\n` and `\t` so that you can include whitespace formatting within your descriptions for improved readability.

_NOTE: This parameter can be set using either "--description" or "-des"_

#### Disabled parameter

This specifies whether an update should be downloadable by end users or not. If left unspecified, the update will not be disabled (i.e. users will download it the moment your app calls `sync`). This parameter can be valuable if you want to release an update that isn't immediately available, until you explicitly [patch it](#patching-releases) when you want end users to be able to download it (e.g. an announcement blog post went live).

_NOTE: This parameter can be set using either "--disabled" or "-x"_

#### Mandatory parameter

This specifies whether the update should be considered mandatory or not (e.g. it includes a critical security fix). This attribute is simply round tripped to the client, who can then decide if and how they would like to enforce it.

_NOTE: This parameter is simply a "flag", and therefore, its absence indicates that the release is optional, and its presence indicates that it's mandatory. You can provide a value to it (e.g. `--mandatory true`), however, simply specifying `--mandatory` is sufficient for marking a release as mandatory._

The mandatory attribute is unique because the server will dynamically modify it as necessary in order to ensure that the semantics of your releases are maintained for your end-users. For example, imagine that you released the following three updates to your app:

| Release | Mandatory? |
| ------- | ---------- |
| v1      | No         |
| v2      | Yes        |
| v3      | No         |

If an end-user is currently running `v1`, and they query the server for an update, it will respond with `v3` (since that is the latest), but it will dynamically convert the release to mandatory, since a mandatory update was released in between. This behavior is important since the code contained in `v3` is incremental to that included in `v2`, and therefore, whatever made `v2` mandatory, continues to make `v3` mandatory for anyone that didn't already acquire `v2`.

If an end-user is currently running `v2`, and they query the server for an update, it will respond with `v3`, but leave the release as optional. This is because they already received the mandatory update, and therefore, there isn't a need to modify the policy of `v3`. This behavior is why we say that the server will "dynamically convert" the mandatory flag, because as far as the release goes, its mandatory attribute will always be stored using the value you specified when releasing it. It is only changed on-the-fly as necessary when responding to an update check from an end-user.

If you never release an update that is marked as mandatory, then the above behavior doesn't apply to you, since the server will never change an optional release to mandatory unless there were intermingled mandatory updates as illustrated above. Additionally, if a release is marked as mandatory, it will never be converted to optional, since that wouldn't make any sense. The server will only change an optional release to mandatory in order to respect the semantics described above.

_NOTE: This parameter can be set using either `--mandatory` or `-m`_

#### No duplicate release error parameter

This specifies that if the update is identical to the latest release on the deployment, the CLI should generate a warning instead of an error. This is useful for continuous integration scenarios where it is expected that small modifications may trigger releases where no production code has changed.

#### Rollout parameter

**IMPORTANT: In order for this parameter to actually take affect, your end users need to be running version `1.9.0-beta+` (for React Native) of the CodePush plugin. If you release an update that specifies a rollout property, no end user running an older version of React Native plugins will be eligible for the update. Therefore, until you have adopted the neccessary version of the platform-specific CodePush plugin (as previously mentioned), we would advise not setting a rollout value on your releases, since no one would end up receiving it.**

This specifies the percentage of users (as an integer between `1` and `100`) that should be eligible to receive this update. It can be helpful if you want to "flight" new releases with a portion of your audience (e.g. 25%), and get feedback and/or watch for exceptions/crashes, before making it broadly available for everyone. If this parameter isn't set, it is set to `100%`, and therefore, you only need to set it if you want to actually limit how many users will receive it.

When leveraging the rollout capability, there are a few additional considerations to keep in mind:

1. You cannot release a new update to a deployment whose latest release is an "active" rollout (i.e. its rollout property is non-null). The rollout needs to be "completed" (i.e. setting the `rollout` property to `100`) before you can release further updates to the deployment.

2. If you rollback a deployment whose latest release is an "active" rollout, the rollout value will be cleared, effectively "deactivating" the rollout behavior

3. Unlike the `mandatory` and `description` fields, when you promote a release from one deployment to another, it will not propagate the `rollout` property, and therefore, if you want the new release (in the target deployment) to have a rollout value, you need to explicitly set it when you call the `promote` command.

_NOTE: This parameter can be set using either `--rollout` or `-r`_

### Releasing Updates (React Native)

```shell
code-push-standalone release-react <appName> <platform>
[--bundleName <bundleName>]
[--deploymentName <deploymentName>]
[--description <description>]
[--development <development>]
[--disabled <disabled>]
[--entryFile <entryFile>]
[--gradleFile <gradleFile>]
[--mandatory]
[--noDuplicateReleaseError]
[--outputDir <outputDir>]
[--plistFile <plistFile>]
[--plistFilePrefix <plistFilePrefix>]
[--sourcemapOutput <sourcemapOutput>]
[--targetBinaryVersion <targetBinaryVersion>]
[--rollout <rolloutPercentage>]
[--useHermes <useHermes>]
[--podFile <podFile>]
[--extraHermesFlags <extraHermesFlags>]
[--privateKeyPath <privateKeyPath>]
[--xcodeProjectFile <xcodeProjectFile>]
[--xcodeTargetName <xcodeTargetName>]
[--buildConfigurationName <buildConfigurationName>]
```

The `release-react` command is a React Native-specific version of the "vanilla" [`release`](#releasing-app-updates) command, which supports all of the same parameters (e.g. `--mandatory`, `--description`), yet simplifies the process of releasing updates by performing the following additional behavior:

1. Running the `react-native bundle` command in order to generate the [update contents](#update-contents-parameter) (JS bundle and assets) that will be released to the CodePush server. It uses sensible defaults as much as possible (e.g. creating a non-dev build, assuming an iOS entry file is named `index.ios.js`), but also exposes the relevant `react-native bundle` parameters to enable flexibility (e.g. `--sourcemapOutput`).

2. Inferring the [`targetBinaryVersion`](#target-binary-version-parameter) of this release by using the version name that is specified in your project's `Info.plist` (for iOS) and `build.gradle` (for Android) files.

To illustrate the difference that the `release-react` command can make, the following is an example of how you might generate and release an update for a React Native app using the "vanilla" `release` command:

```shell
mkdir ./CodePush

react-native bundle --platform ios \
--entry-file index.ios.js \
--bundle-output ./CodePush/main.jsbundle \
--assets-dest ./CodePush \
--dev false

code-push-standalone release MyApp-iOS ./CodePush 1.0.0
```

Achieving the equivalent behavior with the `release-react` command would simply require the following command, which is generally less error-prone:

```shell
code-push-standalone release-react MyApp-iOS ios
```

#### App name parameter

This is the same parameter as the one described in the [above section](#app-name-parameter).

#### Platform parameter

This specifies which platform the current update is targeting, and can be either `android`, `ios` or `windows` (case-insensitive). This value is only used to determine how to properly bundle your update contents and isn't actually sent to the server.

#### Deployment name parameter

This is the same parameter as the one described in the [above section](#deployment-name-parameter).

#### Description parameter

This is the same parameter as the one described in the [above section](#description-parameter).

#### Mandatory parameter

This is the same parameter as the one described in the [above section](#mandatory-parameter).

#### No duplicate release error parameter

This is the same parameter as the one described in the [above section](#no-duplicate-release-error-parameter).

#### Rollout parameter

This is the same parameter as the one described in the [above section](#rollout-parameter). If left unspecified, the release will be made available to all users.

#### Target binary version parameter

This is the same parameter as the one described in the [above section](#target-binary-version-parameter). If left unspecified, this defaults to targeting the exact version specified in the app's `Info.plist` (for iOS) and `build.gradle` (for Android) files.

#### Bundle name parameter

This specifies the file name that should be used for the generated JS bundle. If left unspecified, the standard bundle name will be used for the specified platform: `main.jsbundle` (iOS), `index.android.bundle` (Android) and `index.windows.bundle` (Windows).

_NOTE: This parameter can be set using either --bundleName or -b_

#### Development parameter

This specifies whether to generate a unminified, development JS bundle. If left unspecified, this defaults to `false` where warnings are disabled and the bundle is minified.

_NOTE: This parameter can be set using either --development or --dev_

#### Disabled parameter

This is the same parameter as the one described in the [above section](#disabled-parameter).

#### Entry file parameter

This specifies the relative path to the app's root/entry JavaScript file. If left unspecified, this defaults to `index.ios.js` (for iOS), `index.android.js` (for Android) or `index.windows.bundle` (for Windows) if that file exists, or `index.js` otherwise.

_NOTE: This parameter can be set using either --entryFile or -e_

#### Gradle file parameter (Android only)

This specifies the relative path to the `build.gradle` file that the CLI should use when attempting to auto-detect the target binary version for the release. This parameter is only meant for advanced scenarios, since the CLI will automatically be able to find your `build.grade` file in "standard" React Native projects. However, if your gradle file is located in an arbitrary location, that the CLI can't discover, then using this parameter allows you to continue releasing CodePush updates, without needing to explicitly set the `--targetBinaryVersion` parameter. Since `build.gradle` is a required file name, specifying the path to the containing folder or the full path to the file itself will both achieve the same effect.

```shell
code-push-standalone release-react MyApp-Android android -p "./foo/bar/"
code-push-standalone release-react MyApp-Android android -p "./foo/bar/build.gradle"
```

#### Plist file parameter (iOS only)

This specifies the relative path to the `Info.plist` file that the CLI should use when attempting to auto-detect the target binary version for the release. This parameter is only meant for advanced scenarios, since the CLI will automatically be able to find your `Info.plist` file in "standard" React Native projects, and you can use the `--plistFilePrefix` parameter in order to support per-environment plist files (e.g. `STAGING-Info.plist`). However, if your plist is located in an arbitrary location, that the CLI can't discover, then using this parameter allows you to continue releasing CodePush updates, without needing to explicitly set the `--targetBinaryVersion` parameter.

```shell
code-push-standalone release-react MyApp-iOS ios -p "./foo/bar/MyFile.plist"
```

_NOTE: This parameter can be set using either --plistFile or -p_

#### Plist file prefix parameter (iOS only)

This specifies the file name prefix of the `Info.plist` file that that CLI should use when attempting to auto-detect the target binary version for the release. This can be useful if you've created per-environment plist files (e.g. `DEV-Info.plist`, `STAGING-Info.plist`), and you want to be able to release CodePush updates without needing to explicitly set the `--targetBinaryVersion` parameter. By specifying a `--plistFilePrefx`, the CLI will look for a file named `<prefix>-Info.plist`, instead of simply `Info.plist` (which is the default behavior), in the following locations: `./ios` and `./ios/<appName>`. If your plist file isn't located in either of those directories (e.g. your app is a native iOS app with embedded RN views), or uses an entirely different file naming convention, then consider using the `--plistFile` parameter.

```shell
# Auto-detect the target binary version of this release by looking up the
# app version within the STAGING-Info.plist file in either the ./ios or ./ios/<APP> directories.
code-push-standalone release-react MyApp-iOS ios --pre "STAGING"

# Tell the CLI to use your dev plist (`DEV-Info.plist`).
# Note that the hyphen separator can be explicitly stated.
code-push-standalone release-react MyApp-iOS ios --pre "DEV-"
```

_NOTE: This parameter can be set using either --plistFilePrefix or --pre_

#### Sourcemap output parameter

This specifies the relative path to where the generated JS bundle's sourcemap file should be written. If left unspecified, sourcemaps will not be generated.

_NOTE: This parameter can be set using either --sourcemapOutput or -s_

#### Output directory parameter

This specifies the relative path to where the assets, JS bundle and sourcemap files should be written. If left unspecified, the assets, JS bundle and sourcemap will be copied to the `/tmp/CodePush` folder.

_NOTE: This parameter can be set using either --outputDir or -o_

#### Use Hermes parameter

This parameter enforces the use of the Hermes compiler. If not specified, the automatic checks will be performed, inspecting the `build.gradle` and `Podfile` for the Hermes flag.

_NOTE: This parameter can be set using either --hermesEnabled or -h_

#### Podfile parameter (iOS only)

The Podfile path will be used for Hermes automatic check. Not used if `--useHermes` is specified.

_NOTE: This parameter can be set using either --podfile or -pod_

#### Extra hermes flags parameter

Hermes flags which will be passed to Hermes compiler.

_NOTE: This parameter can be set using either --extraHermesFlags or -hf_

#### Private key path parameter

Private key path which is used for code signing.

_NOTE: This parameter can be set using either --privateKeyPath or -k_

#### Xcode project file parameter

Path to the Xcode project or project.pbxproj file.

_NOTE: This parameter can be set using either --xcodeProjectFile or -xp_

#### Xcode target name parameter

Name of target (PBXNativeTarget) which specifies the binary version you want to target this release at (iOS only).

_NOTE: This parameter can be set using either --xcodeTargetName or -xt_

#### Build configuration name parameter

Name of build configuration which specifies the binary version you want to target this release at. For example, 'Debug' or 'Release' (iOS only).

_NOTE: This parameter can be set using either --buildConfigurationName or -c_

## Debugging CodePush Integration

Once you've released an update, React Native plugin has been integrated into your app, it can be helpful to diagnose how the plugin is behaving, especially if you run into an issue and want to understand why. In order to debug the CodePush update discovery experience, you can run the following command in order to easily view the diagnostic logs produced by the CodePush plugin within your app:

```shell
code-push-standalone debug <platform>

# View all CodePush logs from a running
# instace of the iOS simulator.
code-push-standalone debug ios

# View all CodePush logs from a running
# Android emulator or attached device.
code-push-standalone debug android
```

<img width="500" src="https://cloud.githubusercontent.com/assets/116461/16246597/bd49a9ac-37ba-11e6-9aa4-a2d3b2821a90.png" />

Under the covers, this command simply automates the usage of the iOS system logs and ADB logcat, but provides a platform-agnostic, filtered view of all logs coming from the CodePush plugin. This way, you don't need to learn and/or use another tool simply to be able to answer basic questions about how CodePush is behaving.

_NOTE: The debug command supports both emulators and devices for Android, but currently only supports listening to logs from the iOS simulator. We hope to add device support soon._

## Patching Update Metadata

After releasing an update, there may be scenarios where you need to modify one or more of the metadata attributes associated with it (e.g. you forgot to mark a critical bug fix as mandatory, you want to increase the rollout percentage of an update). You can easily do this by running the following command:

```shell
code-push-standalone patch <appName> <deploymentName>
[--label <releaseLabel>]
[--mandatory <isMandatory>]
[--description <description>]
[--rollout <rolloutPercentage>]
[--disabled <isDisabled>]
[--targetBinaryVersion <targetBinaryVersion>]
```

_NOTE: This command doesn't allow modifying the actual update contents of a release. If you need to respond to a release that has been identified as being broken, you should use the [rollback](#rolling-back-updates) command to immediately roll it back, and then if necessary, release a new update with the approrpriate fix when it is available._

Aside from the `appName` and `deploymentName`, all parameters are optional, and therefore, you can use this command to update just a single attribute or all of them at once. Calling the `patch` command without specifying any attribute flag will result in a no-op.

```shell
# Mark the latest production release as mandatory
code-push-standalone patch MyApp-iOS Production -m

# Increase the rollout for v23 to 50%
code-push-standalone patch MyApp-iOS Production -l v23 -rollout 50%
```

### Label parameter

Indicates which release (e.g. `v23`) you want to update within the specified deployment. If ommitted, the requested changes will be applied to the latest release in the specified deployment. In order to look up the label for the release you want to update, you can run the `code-push-standalone deployment history` command and refer to the `Label` column.

_NOTE: This parameter can be set using either `--label` or `-l`_

### Mandatory parameter

This is the same parameter as the one described in the [above section](#mandatory-parameter), and simply allows you to update whether the release should be considered mandatory or not. Note that `--mandatory` and `--mandatory true` are equivalent, but the absence of this flag is not equivalent to `--mandatory false`. Therefore, if the parameter is ommitted, no change will be made to the value of the target release's mandatory property. You need to set this to `--mandatory false` to explicitly make a release optional.

### Description parameter

This is the same parameter as the one described in the [above section](#description-parameter), and simply allows you to update the description associated with the release (e.g. you made a typo when releasing, or you forgot to add a description at all). If this parameter is ommitted, no change will be made to the value of the target release's description property.

### Disabled parameter

This is the same parameter as the one described in the [above section](#disabled-parameter), and simply allows you to update whether the release should be disabled or not. Note that `--disabled` and `--disabled true` are equivalent, but the absence of this flag is not equivalent to `--disabled false`. Therefore, if the parameter is ommitted, no change will be made to the value of the target release's disabled property. You need to set this to `--disabled false` to explicitly make a release acquirable if it was previously disabled.

### Rollout parameter

This is the same parameter as the one described in the [above section](#rollout-parameter), and simply allows you to increase the rollout percentage of the target release. This parameter can only be set to an integer whose value is greater than the current rollout value. Additionally, if you want to "complete" the rollout, and therefore, make the release available to everyone, you can simply set this parameter to `--rollout 100`. If this parameter is ommitted, no change will be made to the value of the target release's rollout parameter.

Additionally, as mentioned above, when you release an update without a rollout value, it is treated equivalently to setting the rollout to `100`. Therefore, if you released an update without a rollout, you cannot change the rollout property of it via the `patch` command since that would be considered lowering the rollout percentage.

### Target binary version parameter

This is the same parameter as the one described in the [above section](#target-binary-version-parameter), and simply allows you to update the semver range that indicates which binary version(s) a release is compatible with. This can be useful if you made a mistake when originally releasing an update (e.g. you specified `1.0.0` but meant `1.1.0`) or you want to increase or decrease the version range that a release supports (e.g. you discovered that a release doesn't work with `1.1.2` after all). If this parameter is ommitted, no change will be made to the value of the target release's version property.

```shell
# Add a "max binary version" to an existing release
# by scoping its eligibility to users running >= 1.0.5
code-push-standalone patch MyApp-iOS Staging -t "1.0.0 - 1.0.5"
```

## Promoting Updates

Once you've tested an update against a specific deployment (e.g. `Staging`), and you want to promote it "downstream" (e.g. dev->staging, staging->production), you can simply use the following command to copy the release from one deployment to another:

```
code-push-standalone promote <appName> <sourceDeploymentName> <destDeploymentName>
[--description <description>]
[--label <label>]
[--disabled <disabled>]
[--mandatory]
[--noDuplicateReleaseError]
[--rollout <rolloutPercentage>]
[--targetBinaryVersion <targetBinaryVersion]
```

The `promote` command will create a new release for the destination deployment, which includes the **exact code and metadata** (description, mandatory and target binary version) from the latest release of the source deployment. While you could use the `release` command to "manually" migrate an update from one environment to another, the `promote` command has the following benefits:

1. It's quicker, since you don't need to reassemble the release assets you want to publish or remember the description/app store version that are associated with the source deployment's release.

2. It's less error-prone, since the promote operation ensures that the exact thing that you already tested in the source deployment (e.g. `Staging`) will become active in the destination deployment (e.g. `Production`).

We recommend that all users take advantage of the automatically created `Staging` and `Production` environments, and do all releases directly to `Staging`, and then perform a `promote` from `Staging` to `Production` after performing the appropriate testing.

### Description parameter

This is the same parameter as the one described in the [above section](#description-parameter), and simply allows you to override the description that will be used for the promoted release. If unspecified, the new release will inherit the description from the release being promoted.

### Label parameter

This optional parameter allows you to pick the specified label from the source deployment and promote it to the destination deployment. If unspecified, the latest release on the source deployment will be promoted.

### Disabled parameter

This is the same parameter as the one described in the [above section](#disabled-parameter), and simply allows you to override the value of the disabled flag that will be used for the promoted release. If unspecified, the new release will inherit the disabled property from the release being promoted.

### Mandatory parameter

This is the same parameter as the one described in the [above section](#mandatory-parameter), and simply allows you to override the mandatory flag that will be used for the promoted release. If unspecified, the new release will inherit the mandatory property from the release being promoted.

### No duplicate release error parameter

This is the same parameter as the one described in the [above section](#no-duplicate-release-error-parameter).

### Rollout parameter

This is the same parameter as the one described in the [above section](#rollout-parameter), and allows you to specify whether the newly created release should only be made available to a portion of your users. Unlike the other release metadata parameters (e.g. `description`), the `rollout` of a release is not carried over/inherited as part of a promote, and therefore, you need to explicitly set this if you don't want the newly created release to be available to all of your users.

### Target binary version parameter

This is the same parameter as the one described in the [above section](#target-binary-version-parameter), and simply allows you to override the target binary version that will be used for the promoted release. If unspecified, the new release will inherit the target binary version property from the release being promoted.

```shell
# Promote the release to production and make it
# available to all versions using that deployment
code-push-standalone promote MyApp-iOS Staging Production -t "*"
```

## Rolling Back Updates

A deployment's release history is immutable, so you cannot delete or remove an update once it has been released. However, if you release an update that is broken or contains unintended features, it is easy to roll it back using the `rollback` command:

```
code-push-standalone rollback <appName> <deploymentName>
code-push-standalone rollback MyApp-iOS Production
```

This has the effect of creating a new release for the deployment that includes the **exact same code and metadata** as the version prior to the latest one. For example, imagine that you released the following updates to your app:

| Release | Description       | Mandatory |
| ------- | ----------------- | --------- |
| v1      | Initial release!  | Yes       |
| v2      | Added new feature | No        |
| v3      | Bug fixes         | Yes       |

If you ran the `rollback` command on that deployment, a new release (`v4`) would be created that included the contents of the `v2` release.

| Release                     | Description       | Mandatory |
| --------------------------- | ----------------- | --------- |
| v1                          | Initial release!  | Yes       |
| v2                          | Added new feature | No        |
| v3                          | Bug fixes         | Yes       |
| v4 (Rollback from v3 to v2) | Added new feature | No        |

End-users that had already acquired `v3` would now be "moved back" to `v2` when the app performs an update check. Additionally, any users that were still running `v2`, and therefore, had never acquired `v3`, wouldn't receive an update since they are already running the latest release (this is why our update check uses the package hash in addition to the release label).

If you would like to rollback a deployment to a release other than the previous (e.g. `v3` -> `v2`), you can specify the optional `--targetRelease` parameter:

```
code-push-standalone rollback MyApp-iOS Production --targetRelease v34
```

_NOTE: The release produced by a rollback will be annotated in the output of the `deployment history` command to help identify them more easily._

## Viewing Release History

You can view a history of the 50 most recent releases for a specific app deployment using the following command:

```
code-push-standalone deployment history <appName> <deploymentName>
```

The history will display all attributes about each release (e.g. label, mandatory) as well as indicate if any releases were made due to a promotion or a rollback operation.

![Deployment History](https://cloud.githubusercontent.com/assets/696206/11605068/14e440d0-9aab-11e5-8837-69ab09bfb66c.PNG)

Additionally, the history displays the install metrics for each release. You can view the details about how to interpret the metric data in the documentation for the `deployment ls` command above.

By default, the history doesn't display the author of each release, but if you are collaborating on an app with other developers, and want to view who released each update, you can pass the additional `--displayAuthor` (or `-a`) flag to the history command.

_NOTE: The history command can also be run using the "h" alias_

## Clearing Release History

You can clear the release history associated with a deployment using the following command:

```
code-push-standalone deployment clear <appName> <deploymentName>
```

After running this command, client devices configured to receive updates using its associated deployment key will no longer receive the updates that have been cleared. This command is irreversible, and therefore should not be used in a production deployment.

## Code Signing for CodePush

Code Signing ensures that updates deployed via CodePush are secure and verified. Follow these steps to set up Code Signing:

### 1. Generate a Signing Key

**Create private and public keys using OpenSSL:**

```shell
# generate private RSA key and write it to private.pem file
openssl genrsa -out private.pem

# export public key from private.pem into public.pem
openssl rsa -pubout -in private.pem -out public.pem
```

### 2. Configure CodePush CLI

**Specify the path to your private key when releasing updates:**

```shell
code-push-standalone release-react <appName> <platform> --privateKeyPath private.pem
```

### 3. Configure Your App

#### iOS

**Add the public key to your `Info.plist`:**

- Open your `Info.plist` file.
- Add a new entry:

    ```xml
    <key>CodePushPublicKey</key>
    <string>-----BEGIN PUBLIC KEY-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
    -----END PUBLIC KEY-----</string>
    ```

Replace the placeholder with the actual contents of your `public.pem` file.

#### Android

**Add the public key to your `strings.xml`:**

- Open `res/values/strings.xml`.
- Add the following entry:

    ```xml
    <string name="CodePushPublicKey">-----BEGIN PUBLIC KEY-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
    -----END PUBLIC KEY-----</string>
    ```

Replace the placeholder with the actual contents of your `public.pem` file.