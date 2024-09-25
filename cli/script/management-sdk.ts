// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Q = require("q");
import superagent = require("superagent");
import * as recursiveFs from "recursive-fs";
import * as yazl from "yazl";
import slash = require("slash");

import Promise = Q.Promise;

import {
  AccessKey,
  AccessKeyRequest,
  Account,
  App,
  CodePushError,
  CollaboratorMap,
  Deployment,
  DeploymentMetrics,
  Headers,
  Package,
  PackageInfo,
  ServerAccessKey,
  Session,
} from "./types";

const packageJson = require("../../package.json");

interface JsonResponse {
  headers: Headers;
  body?: any;
}

interface PackageFile {
  isTemporary: boolean;
  path: string;
}

// A template string tag function that URL encodes the substituted values
function urlEncode(strings: string[], ...values: string[]): string {
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += encodeURIComponent(values[i]);
    }
  }

  return result;
}

class AccountManager {
  public static AppPermission = {
    OWNER: "Owner",
    COLLABORATOR: "Collaborator",
  };
  public static SERVER_URL = "http://localhost:3000";

  private static API_VERSION: number = 2;

  public static ERROR_GATEWAY_TIMEOUT = 504; // Used if there is a network error
  public static ERROR_INTERNAL_SERVER = 500;
  public static ERROR_NOT_FOUND = 404;
  public static ERROR_CONFLICT = 409; // Used if the resource already exists
  public static ERROR_UNAUTHORIZED = 401;

  private _accessKey: string;
  private _serverUrl: string;
  private _customHeaders: Headers;

  constructor(accessKey: string, customHeaders?: Headers, serverUrl?: string) {
    if (!accessKey) throw new Error("An access key must be specified.");

    this._accessKey = accessKey;
    this._customHeaders = customHeaders;
    this._serverUrl = serverUrl || AccountManager.SERVER_URL;
  }

  public get accessKey(): string {
    return this._accessKey;
  }

  public isAuthenticated(throwIfUnauthorized?: boolean): Promise<boolean> {
    return Promise<any>((resolve, reject, notify) => {
      const request: superagent.Request<any> = superagent.get(`${this._serverUrl}${urlEncode(["/authenticated"])}`);
      this.attachCredentials(request);

      request.end((err: any, res: superagent.Response) => {
        const status: number = this.getErrorStatus(err, res);
        if (err && status !== AccountManager.ERROR_UNAUTHORIZED) {
          reject(this.getCodePushError(err, res));
          return;
        }

        const authenticated: boolean = status === 200;

        if (!authenticated && throwIfUnauthorized) {
          reject(this.getCodePushError(err, res));
          return;
        }

        resolve(authenticated);
      });
    });
  }

  public addAccessKey(friendlyName: string, ttl?: number): Promise<AccessKey> {
    if (!friendlyName) {
      throw new Error("A name must be specified when adding an access key.");
    }

    const accessKeyRequest: AccessKeyRequest = {
      createdBy: os.hostname(),
      friendlyName,
      ttl,
    };

    return this.post(urlEncode(["/accessKeys/"]), JSON.stringify(accessKeyRequest), /*expectResponseBody=*/ true).then(
      (response: JsonResponse) => {
        return {
          createdTime: response.body.accessKey.createdTime,
          expires: response.body.accessKey.expires,
          key: response.body.accessKey.name,
          name: response.body.accessKey.friendlyName,
        };
      }
    );
  }

  public getAccessKey(accessKeyName: string): Promise<AccessKey> {
    return this.get(urlEncode([`/accessKeys/${accessKeyName}`])).then((res: JsonResponse) => {
      return {
        createdTime: res.body.accessKey.createdTime,
        expires: res.body.accessKey.expires,
        name: res.body.accessKey.friendlyName,
      };
    });
  }

  public getAccessKeys(): Promise<AccessKey[]> {
    return this.get(urlEncode(["/accessKeys"])).then((res: JsonResponse) => {
      const accessKeys: AccessKey[] = [];

      res.body.accessKeys.forEach((serverAccessKey: ServerAccessKey) => {
        !serverAccessKey.isSession &&
          accessKeys.push({
            createdTime: serverAccessKey.createdTime,
            expires: serverAccessKey.expires,
            name: serverAccessKey.friendlyName,
          });
      });

      return accessKeys;
    });
  }

  public getSessions(): Promise<Session[]> {
    return this.get(urlEncode(["/accessKeys"])).then((res: JsonResponse) => {
      // A machine name might be associated with multiple session keys,
      // but we should only return one per machine name.
      const sessionMap: { [machineName: string]: Session } = {};
      const now: number = new Date().getTime();
      res.body.accessKeys.forEach((serverAccessKey: ServerAccessKey) => {
        if (serverAccessKey.isSession && serverAccessKey.expires > now) {
          sessionMap[serverAccessKey.createdBy] = {
            loggedInTime: serverAccessKey.createdTime,
            machineName: serverAccessKey.createdBy,
          };
        }
      });

      const sessions: Session[] = Object.keys(sessionMap).map((machineName: string) => sessionMap[machineName]);

      return sessions;
    });
  }

  public patchAccessKey(oldName: string, newName?: string, ttl?: number): Promise<AccessKey> {
    const accessKeyRequest: AccessKeyRequest = {
      friendlyName: newName,
      ttl,
    };

    return this.patch(urlEncode([`/accessKeys/${oldName}`]), JSON.stringify(accessKeyRequest)).then((res: JsonResponse) => {
      return {
        createdTime: res.body.accessKey.createdTime,
        expires: res.body.accessKey.expires,
        name: res.body.accessKey.friendlyName,
      };
    });
  }

  public removeAccessKey(name: string): Promise<void> {
    return this.del(urlEncode([`/accessKeys/${name}`])).then(() => null);
  }

  public removeSession(machineName: string): Promise<void> {
    return this.del(urlEncode([`/sessions/${machineName}`])).then(() => null);
  }

  // Account
  public getAccountInfo(): Promise<Account> {
    return this.get(urlEncode(["/account"])).then((res: JsonResponse) => res.body.account);
  }

  // Apps
  public getApps(): Promise<App[]> {
    return this.get(urlEncode(["/apps"])).then((res: JsonResponse) => res.body.apps);
  }

  public getApp(appName: string): Promise<App> {
    return this.get(urlEncode([`/apps/${appName}`])).then((res: JsonResponse) => res.body.app);
  }

  public addApp(appName: string): Promise<App> {
    const app: App = { name: appName };
    return this.post(urlEncode(["/apps/"]), JSON.stringify(app), /*expectResponseBody=*/ false).then(() => app);
  }

  public removeApp(appName: string): Promise<void> {
    return this.del(urlEncode([`/apps/${appName}`])).then(() => null);
  }

  public renameApp(oldAppName: string, newAppName: string): Promise<void> {
    return this.patch(urlEncode([`/apps/${oldAppName}`]), JSON.stringify({ name: newAppName })).then(() => null);
  }

  public transferApp(appName: string, email: string): Promise<void> {
    return this.post(urlEncode([`/apps/${appName}/transfer/${email}`]), /*requestBody=*/ null, /*expectResponseBody=*/ false).then(
      () => null
    );
  }

  // Collaborators
  public getCollaborators(appName: string): Promise<CollaboratorMap> {
    return this.get(urlEncode([`/apps/${appName}/collaborators`])).then((res: JsonResponse) => res.body.collaborators);
  }

  public addCollaborator(appName: string, email: string): Promise<void> {
    return this.post(
      urlEncode([`/apps/${appName}/collaborators/${email}`]),
      /*requestBody=*/ null,
      /*expectResponseBody=*/ false
    ).then(() => null);
  }

  public removeCollaborator(appName: string, email: string): Promise<void> {
    return this.del(urlEncode([`/apps/${appName}/collaborators/${email}`])).then(() => null);
  }

  // Deployments
  public addDeployment(appName: string, deploymentName: string): Promise<Deployment> {
    const deployment = <Deployment>{ name: deploymentName };
    return this.post(urlEncode([`/apps/${appName}/deployments/`]), JSON.stringify(deployment), /*expectResponseBody=*/ true).then(
      (res: JsonResponse) => res.body.deployment
    );
  }

  public clearDeploymentHistory(appName: string, deploymentName: string): Promise<void> {
    return this.del(urlEncode([`/apps/${appName}/deployments/${deploymentName}/history`])).then(() => null);
  }

  public getDeployments(appName: string): Promise<Deployment[]> {
    return this.get(urlEncode([`/apps/${appName}/deployments/`])).then((res: JsonResponse) => res.body.deployments);
  }

  public getDeployment(appName: string, deploymentName: string): Promise<Deployment> {
    return this.get(urlEncode([`/apps/${appName}/deployments/${deploymentName}`])).then((res: JsonResponse) => res.body.deployment);
  }

  public renameDeployment(appName: string, oldDeploymentName: string, newDeploymentName: string): Promise<void> {
    return this.patch(
      urlEncode([`/apps/${appName}/deployments/${oldDeploymentName}`]),
      JSON.stringify({ name: newDeploymentName })
    ).then(() => null);
  }

  public removeDeployment(appName: string, deploymentName: string): Promise<void> {
    return this.del(urlEncode([`/apps/${appName}/deployments/${deploymentName}`])).then(() => null);
  }

  public getDeploymentMetrics(appName: string, deploymentName: string): Promise<DeploymentMetrics> {
    return this.get(urlEncode([`/apps/${appName}/deployments/${deploymentName}/metrics`])).then(
      (res: JsonResponse) => res.body.metrics
    );
  }

  public getDeploymentHistory(appName: string, deploymentName: string): Promise<Package[]> {
    return this.get(urlEncode([`/apps/${appName}/deployments/${deploymentName}/history`])).then(
      (res: JsonResponse) => res.body.history
    );
  }

  public release(
    appName: string,
    deploymentName: string,
    filePath: string,
    targetBinaryVersion: string,
    updateMetadata: PackageInfo,
    uploadProgressCallback?: (progress: number) => void
  ): Promise<void> {
    return Promise<void>((resolve, reject, notify) => {
      updateMetadata.appVersion = targetBinaryVersion;
      const request: superagent.Request<any> = superagent.post(
        this._serverUrl + urlEncode([`/apps/${appName}/deployments/${deploymentName}/release`])
      );

      this.attachCredentials(request);

      const getPackageFilePromise = Q.Promise((resolve, reject) => {
        this.packageFileFromPath(filePath)
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            reject(error);
          });
      });

      getPackageFilePromise.then((packageFile: PackageFile) => {
        const file: any = fs.createReadStream(packageFile.path);
        request
          .attach("package", file)
          .field("packageInfo", JSON.stringify(updateMetadata))
          .on("progress", (event: any) => {
            if (uploadProgressCallback && event && event.total > 0) {
              const currentProgress: number = (event.loaded / event.total) * 100;
              uploadProgressCallback(currentProgress);
            }
          })
          .end((err: any, res: superagent.Response) => {
            if (packageFile.isTemporary) {
              fs.unlinkSync(packageFile.path);
            }

            if (err) {
              reject(this.getCodePushError(err, res));
              return;
            }

            if (res.ok) {
              resolve(<void>null);
            } else {
              let body;
              try {
                body = JSON.parse(res.text);
              } catch (err) {}

              if (body) {
                reject(<CodePushError>{
                  message: body.message,
                  statusCode: res && res.status,
                });
              } else {
                reject(<CodePushError>{
                  message: res.text,
                  statusCode: res && res.status,
                });
              }
            }
          });
      });
    });
  }

  public patchRelease(appName: string, deploymentName: string, label: string, updateMetadata: PackageInfo): Promise<void> {
    updateMetadata.label = label;
    const requestBody: string = JSON.stringify({ packageInfo: updateMetadata });
    return this.patch(
      urlEncode([`/apps/${appName}/deployments/${deploymentName}/release`]),
      requestBody,
      /*expectResponseBody=*/ false
    ).then(() => null);
  }

  public promote(
    appName: string,
    sourceDeploymentName: string,
    destinationDeploymentName: string,
    updateMetadata: PackageInfo
  ): Promise<void> {
    const requestBody: string = JSON.stringify({ packageInfo: updateMetadata });
    return this.post(
      urlEncode([`/apps/${appName}/deployments/${sourceDeploymentName}/promote/${destinationDeploymentName}`]),
      requestBody,
      /*expectResponseBody=*/ false
    ).then(() => null);
  }

  public rollback(appName: string, deploymentName: string, targetRelease?: string): Promise<void> {
    return this.post(
      urlEncode([`/apps/${appName}/deployments/${deploymentName}/rollback/${targetRelease || ``}`]),
      /*requestBody=*/ null,
      /*expectResponseBody=*/ false
    ).then(() => null);
  }

  private packageFileFromPath(filePath: string) {
    let getPackageFilePromise: Promise<PackageFile>;
    if (fs.lstatSync(filePath).isDirectory()) {
      getPackageFilePromise = Promise<PackageFile>((resolve: (file: PackageFile) => void, reject: (reason: Error) => void): void => {
        const directoryPath: string = filePath;

        recursiveFs.readdirr(directoryPath, (error?: any, directories?: string[], files?: string[]) => {
          if (error) {
            reject(error);
            return;
          }

          const baseDirectoryPath = path.dirname(directoryPath);
          const fileName: string = this.generateRandomFilename(15) + ".zip";
          const zipFile = new yazl.ZipFile();
          const writeStream: fs.WriteStream = fs.createWriteStream(fileName);

          zipFile.outputStream
            .pipe(writeStream)
            .on("error", (error: Error): void => {
              reject(error);
            })
            .on("close", (): void => {
              filePath = path.join(process.cwd(), fileName);

              resolve({ isTemporary: true, path: filePath });
            });

          for (let i = 0; i < files.length; ++i) {
            const file: string = files[i];
            // yazl does not like backslash (\) in the metadata path.
            const relativePath: string = slash(path.relative(baseDirectoryPath, file));

            zipFile.addFile(file, relativePath);
          }

          zipFile.end();
        });
      });
    } else {
      getPackageFilePromise = Q({ isTemporary: false, path: filePath });
    }
    return getPackageFilePromise;
  }

  private generateRandomFilename(length: number): string {
    let filename: string = "";
    const validChar: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < length; i++) {
      filename += validChar.charAt(Math.floor(Math.random() * validChar.length));
    }

    return filename;
  }

  private get(endpoint: string, expectResponseBody: boolean = true): Promise<JsonResponse> {
    return this.makeApiRequest("get", endpoint, /*requestBody=*/ null, expectResponseBody, /*contentType=*/ null);
  }

  private post(
    endpoint: string,
    requestBody: string,
    expectResponseBody: boolean,
    contentType: string = "application/json;charset=UTF-8"
  ): Promise<JsonResponse> {
    return this.makeApiRequest("post", endpoint, requestBody, expectResponseBody, contentType);
  }

  private patch(
    endpoint: string,
    requestBody: string,
    expectResponseBody: boolean = false,
    contentType: string = "application/json;charset=UTF-8"
  ): Promise<JsonResponse> {
    return this.makeApiRequest("patch", endpoint, requestBody, expectResponseBody, contentType);
  }

  private del(endpoint: string, expectResponseBody: boolean = false): Promise<JsonResponse> {
    return this.makeApiRequest("del", endpoint, /*requestBody=*/ null, expectResponseBody, /*contentType=*/ null);
  }

  private makeApiRequest(
    method: string,
    endpoint: string,
    requestBody: string,
    expectResponseBody: boolean,
    contentType: string
  ): Promise<JsonResponse> {
    return Promise<JsonResponse>((resolve, reject, notify) => {
      let request: superagent.Request<any> = (<any>superagent)[method](this._serverUrl + endpoint);

      this.attachCredentials(request);

      if (requestBody) {
        if (contentType) {
          request = request.set("Content-Type", contentType);
        }

        request = request.send(requestBody);
      }

      request.end((err: any, res: superagent.Response) => {
        if (err) {
          reject(this.getCodePushError(err, res));
          return;
        }
        let body;
        try {
          body = JSON.parse(res.text);
        } catch (err) {}

        if (res.ok) {
          if (expectResponseBody && !body) {
            reject(<CodePushError>{
              message: `Could not parse response: ${res.text}`,
              statusCode: AccountManager.ERROR_INTERNAL_SERVER,
            });
          } else {
            resolve(<JsonResponse>{
              headers: res.header,
              body: body,
            });
          }
        } else {
          if (body) {
            reject(<CodePushError>{
              message: body.message,
              statusCode: this.getErrorStatus(err, res),
            });
          } else {
            reject(<CodePushError>{
              message: res.text,
              statusCode: this.getErrorStatus(err, res),
            });
          }
        }
      });
    });
  }

  private getCodePushError(error: any, response: superagent.Response): CodePushError {
    if (error.syscall === "getaddrinfo") {
      error.message = `Unable to connect to the CodePush server. Are you offline, or behind a firewall or proxy?\n(${error.message})`;
    }

    return {
      message: this.getErrorMessage(error, response),
      statusCode: this.getErrorStatus(error, response),
    };
  }

  private getErrorStatus(error: any, response: superagent.Response): number {
    return (error && error.status) || (response && response.status) || AccountManager.ERROR_GATEWAY_TIMEOUT;
  }

  private getErrorMessage(error: Error, response: superagent.Response): string {
    return response && response.text ? response.text : error.message;
  }

  private attachCredentials(request: superagent.Request<any>): void {
    if (this._customHeaders) {
      for (const headerName in this._customHeaders) {
        request.set(headerName, this._customHeaders[headerName]);
      }
    }

    request.set("Accept", `application/vnd.code-push.v${AccountManager.API_VERSION}+json`);
    request.set("Authorization", `Bearer ${this._accessKey}`);
    request.set("X-CodePush-SDK-Version", packageJson.version);
  }
}

export = AccountManager;
