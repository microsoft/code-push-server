// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as q from "q";
import * as shortid from "shortid";
import * as stream from "stream";
import * as storage from "./storage";
import * as utils from "../utils/common";

class GcpStorage implements storage.Storage {
  public static NO_ID_ERROR = "No id set";
  public constructor() {
    shortid.characters("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-");
  }

  public checkHealth(): q.Promise<void> {
    return q.Promise<void>((resolve, reject) => {
      resolve();
    });
  }
    public addAccount(account: storage.Account): q.Promise<string> {
        account = storage.clone(account); // pass by value
        account.id = shortid.generate();
        return q.resolve(account.id);
    }

    public getAccount(accountId: string): q.Promise<storage.Account> {
        return q.resolve({});
    }

  public getAccountByEmail(email: string): q.Promise<storage.Account> {
    return q.resolve({});
  }
    public addApp(accountId: string, app: storage.App): q.Promise<storage.App> {
        app = storage.clone(app); // pass by value
        app.id = shortid.generate();
        return q.resolve(app);
    }

    public getApps(accountId: string): q.Promise<storage.App[]> {
        return q.resolve([]);
    }

    public getApp(accountId: string, appId: string, keepCollaboratorIds: boolean = false): q.Promise<storage.App> {
       return q.resolve({});
    }
    public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<string> {
        return q.resolve("deploymentId");
    }

    public getDeploymentInfo(deploymentKey: string): q.Promise<storage.DeploymentInfo> {
      return q.resolve({});
    }
    public getDeployments(accountId: string, appId: string): q.Promise<storage.Deployment[]> {
      return q.resolve([]);
    }
    public getDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Deployment> {
        return q.resolve({});
    }

    public commitPackage(
        accountId: string,
        appId: string,
        deploymentId: string,
        appPackage: storage.Package
    ): q.Promise<storage.Package> {
        return q.resolve({});
    }

    public getPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Package[]> {
        return q.resolve([]);
    }

    public addBlob(blobId: string, stream: stream.Readable, streamLength: number): q.Promise<string> {
        return q.resolve("blobId");
    }

    public getBlobUrl(blobId: string): q.Promise<string> {
        return q.resolve("blobUrl");
    }
  public removeBlob(blobId: string): q.Promise<void> {
        return q.resolve();
    }
}
