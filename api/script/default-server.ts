// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as api from "./api";
import { AzureStorage } from "./storage/azure-storage";
import { fileUploadMiddleware } from "./file-upload-manager";
import { JsonStorage } from "./storage/json-storage";
import { RedisManager } from "./redis-manager";
import { Storage } from "./storage/storage";
import { Response } from "express";
import { createIpRestrictionMiddleware } from "./middleware/ip-restriction";
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

import * as bodyParser from "body-parser";
const domain = require("express-domain-middleware");
import * as express from "express";
import * as q from "q";

export function start(done: (err?: any, server?: express.Express, storage?: Storage) => void, useJsonStorage?: boolean): void {
  let storage: Storage;
  let isKeyVaultConfigured: boolean;
  let keyvaultClient: any;

  q<void>(null)
    .then(async () => {
      if (useJsonStorage) {
        storage = new JsonStorage();
      } else if (!process.env.AZURE_KEYVAULT_ACCOUNT) {
        storage = new AzureStorage();
      } else {
        isKeyVaultConfigured = true;
        const credential = new DefaultAzureCredential();
        const vaultName = process.env.AZURE_KEYVAULT_ACCOUNT;
        const url = `https://${vaultName}.vault.azure.net`;
        const keyvaultClient = new SecretClient(url, credential);
        const secret = await keyvaultClient.getSecret(`storage-${process.env.AZURE_STORAGE_ACCOUNT}`);
        storage = new AzureStorage(process.env.AZURE_STORAGE_ACCOUNT, secret);
      }
    })
    .then(() => {
      const app = express();
      const auth = api.auth({ storage: storage });
      const appInsights = api.appInsights();
      const redisManager = new RedisManager();

      // First, wrap all requests and catch all exceptions
      app.use(domain);

      // Add IP restriction middleware before other middleware
      const ipRestriction = createIpRestrictionMiddleware({
        allowedIps: process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : [],
        restrictedPaths: ["/auth/"]
      });
      app.use(ipRestriction);

      // Rest of the middleware and routes...
      if (process.env.DISABLE_MANAGEMENT !== "true") {
        if (process.env.DEBUG_DISABLE_AUTH === "true") {
          app.use((req, res, next) => {
            let userId: string = "default";
            if (process.env.DEBUG_USER_ID) {
              userId = process.env.DEBUG_USER_ID;
            } else {
              console.log("No DEBUG_USER_ID environment variable configured. Using 'default' as user id");
            }
            req.user = { id: userId };
            next();
          });
        } else {
          app.use(auth.router());
        }
        app.use(auth.authenticate, fileUploadMiddleware, api.management({ storage: storage, redisManager: redisManager }));
      } else {
        app.use(auth.legacyRouter());
      }

      // The rest of your existing code...
      done(null, app, storage);
    })
    .done();
}