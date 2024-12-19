// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import AccountManager = require("../management-sdk");

export enum CommandType {
  accessKeyAdd,
  accessKeyPatch,
  accessKeyList,
  accessKeyRemove,
  appAdd,
  appList,
  appRemove,
  appRename,
  appTransfer,
  collaboratorAdd,
  collaboratorList,
  collaboratorRemove,
  debug,
  deploymentAdd,
  deploymentHistory,
  deploymentHistoryClear,
  deploymentList,
  deploymentMetrics,
  deploymentRemove,
  deploymentRename,
  link,
  login,
  logout,
  patch,
  promote,
  register,
  release,
  releaseReact,
  rollback,
  sessionList,
  sessionRemove,
  whoami,
}

export interface ICommand {
  type: CommandType;
}

export interface IAccessKeyAddCommand extends ICommand {
  name: string;
  ttl?: number;
}

export interface IAccessKeyPatchCommand extends ICommand {
  newName?: string;
  oldName: string;
  ttl?: number;
}

export interface IAccessKeyListCommand extends ICommand {
  format: string;
}

export interface IAccessKeyRemoveCommand extends ICommand {
  accessKey: string;
}

export interface IAppAddCommand extends ICommand {
  appName: string;
  os: string;
  platform: string;
}

export interface IAppListCommand extends ICommand {
  format: string;
}

export interface IAppRemoveCommand extends ICommand {
  appName: string;
}

export interface IAppRenameCommand extends ICommand {
  currentAppName: string;
  newAppName: string;
}

export interface IAppTransferCommand extends ICommand {
  appName: string;
  email: string;
}

export interface ICollaboratorAddCommand extends ICommand {
  appName: string;
  email: string;
}

export interface ICollaboratorListCommand extends ICommand {
  appName: string;
  format: string;
}

export interface ICollaboratorRemoveCommand extends ICommand {
  appName: string;
  email: string;
}

export interface IDebugCommand extends ICommand {
  platform: string;
}

export interface IDeploymentAddCommand extends ICommand {
  appName: string;
  deploymentName: string;
  key?: string;
  default: boolean;
}

export interface IDeploymentHistoryClearCommand extends ICommand {
  appName: string;
  deploymentName: string;
}

export interface IDeploymentHistoryCommand extends ICommand {
  appName: string;
  deploymentName: string;
  format: string;
  displayAuthor: boolean;
}

export interface IDeploymentListCommand extends ICommand {
  appName: string;
  format: string;
  displayKeys: boolean;
}

export interface IDeploymentRemoveCommand extends ICommand {
  appName: string;
  deploymentName: string;
}

export interface IDeploymentRenameCommand extends ICommand {
  appName: string;
  currentDeploymentName: string;
  newDeploymentName: string;
}

export interface ILinkCommand extends ICommand {
  serverUrl?: string;
}

export interface ILoginCommand extends ICommand {
  serverUrl?: string;
  accessKey: string;
}

export interface IPackageInfo {
  description?: string;
  label?: string;
  disabled?: boolean;
  mandatory?: boolean;
  rollout?: number;
}

export interface IPatchCommand extends ICommand, IPackageInfo {
  appName: string;
  appStoreVersion?: string;
  deploymentName: string;
  label: string;
}

export interface IPromoteCommand extends ICommand, IPackageInfo {
  appName: string;
  appStoreVersion?: string;
  sourceDeploymentName: string;
  destDeploymentName: string;
  noDuplicateReleaseError?: boolean;
}

export interface IRegisterCommand extends ICommand {
  serverUrl?: string;
}

export interface IReleaseBaseCommand extends ICommand, IPackageInfo {
  appName: string;
  appStoreVersion: string;
  deploymentName: string;
  noDuplicateReleaseError?: boolean;
  privateKeyPath?: string;
}

export interface IReleaseCommand extends IReleaseBaseCommand {
  package: string;
}

export interface IReleaseReactCommand extends IReleaseBaseCommand {
  bundleName?: string;
  development?: boolean;
  entryFile?: string;
  gradleFile?: string;
  platform: string;
  plistFile?: string;
  plistFilePrefix?: string;
  sourcemapOutput?: string;
  outputDir?: string;
  config?: string;
  useHermes?: boolean;
  extraHermesFlags?: string[];
  podFile?: string;
  xcodeProjectFile?: string;
  xcodeTargetName?: string;
  buildConfigurationName?: string;
}

export interface IRollbackCommand extends ICommand {
  appName: string;
  deploymentName: string;
  targetRelease: string;
}

export interface ISessionListCommand extends ICommand {
  format: string;
}

export interface ISessionRemoveCommand extends ICommand {
  machineName: string;
}

export type ReleaseHook = (
  currentCommand: IReleaseCommand,
  originalCommand: IReleaseCommand,
  sdk: AccountManager
) => Q.Promise<IReleaseCommand | void>;

export interface ReleaseFile {
  sourceLocation: string; // The current location of the file on disk
  targetLocation: string; // The desired location of the file within the zip
}
