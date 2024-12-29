// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as api from "./api";
import { AzureStorage } from "./storage/azure-storage";
import { fileUploadMiddleware } from "./file-upload-manager";
import { JsonStorage } from "./storage/json-storage";
import { RedisManager } from "./redis-manager";
import { Storage } from "./storage/storage";
import { Response } from "express";
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

import * as bodyParser from "body-parser";
const domain = require("express-domain-middleware");
import * as express from "express";
import * as q from "q";

interface Secret {
  id: string;
  value: string;
}

function bodyParserErrorHandler(err: any, req: express.Request, res: express.Response, next: Function): void {
  if (err) {
    if (err.message === "invalid json" || (err.name === "SyntaxError" && ~err.stack.indexOf("body-parser"))) {
      req.body = null;
      next();
    } else {
      next(err);
    }
  } else {
    next();
  }
}

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

      // First, to wrap all requests and catch all exceptions.
      app.use(domain);

      // Monkey-patch res.send and res.setHeader to no-op after the first call and prevent "already sent" errors.
      app.use((req: express.Request, res: express.Response, next: (err?: any) => void): any => {
        const originalSend = res.send;
        const originalSetHeader = res.setHeader;
        res.setHeader = (name: string, value: string | number | readonly string[]): Response => {
          if (!res.headersSent) {
            originalSetHeader.apply(res, [name, value]);
          }

          return {} as Response;
        };

        res.send = (body: any) => {
          if (res.headersSent) {
            return res;
          }

          return originalSend.apply(res, [body]);
        };

        next();
      });

      if (process.env.LOGGING) {
        app.use((req: express.Request, res: express.Response, next: (err?: any) => void): any => {
          console.log(); // Newline to mark new request
          console.log(`[REST] Received ${req.method} request at ${req.originalUrl}`);
          next();
        });
      }

      // Enforce a timeout on all requests.
      app.use(api.requestTimeoutHandler());

      // Before other middleware which may use request data that this middleware modifies.
      app.use(api.inputSanitizer());

      // body-parser must be before the Application Insights router.
      app.use(bodyParser.urlencoded({ extended: true }));
      const jsonOptions: any = { limit: "10kb", strict: true };
      if (process.env.LOG_INVALID_JSON_REQUESTS === "true") {
        jsonOptions.verify = (req: express.Request, res: express.Response, buf: Buffer, encoding: string) => {
          if (buf && buf.length) {
            (<any>req).rawBody = buf.toString();
          }
        };
      }

      app.use(bodyParser.json(jsonOptions));

      // If body-parser throws an error, catch it and set the request body to null.
      app.use(bodyParserErrorHandler);

      // Before all other middleware to ensure all requests are tracked.
      app.use(appInsights.router());

      app.get("/", (req: express.Request, res: express.Response, next: (err?: Error) => void): any => {
        res.send("Welcome to the CodePush REST API!");
      });

      app.set("etag", false);
      app.set("views", __dirname + "/views");
      app.set("view engine", "ejs");
      app.use("/auth/images/", express.static(__dirname + "/views/images"));
      app.use(api.headers({ origin: process.env.CORS_ORIGIN || "http://localhost:4000" }));
      app.use(api.health({ storage: storage, redisManager: redisManager }));

      if (process.env.DISABLE_ACQUISITION !== "true") {
        app.use(api.acquisition({ storage: storage, redisManager: redisManager }));
      }

      if (process.env.DISABLE_MANAGEMENT !== "true") {
        if (process.env.DEBUG_DISABLE_AUTH === "true") {
          app.use((req, res, next) => {
            let userId: string = "default";
            if (process.env.DEBUG_USER_ID) {
              userId = process.env.DEBUG_USER_ID;
            } else {
              console.log("No DEBUG_USER_ID environment variable configured. Using 'default' as user id");
            }

            req.user = {
              id: userId,
            };

            next();
          });
        } else {
          app.use(auth.router());
          // to support auth via browser app
          app.use('/app', auth.appRouter());
        }
        app.use(auth.authenticate, fileUploadMiddleware, api.management({ storage: storage, redisManager: redisManager }));
      } else {
        app.use(auth.legacyRouter());
      }

      // Error handler needs to be the last middleware so that it can catch all unhandled exceptions
      app.use(appInsights.errorHandler);

      if (isKeyVaultConfigured) {
        // Refresh credentials from the vault regularly as the key is rotated
        setInterval(() => {
          keyvaultClient
            .getSecret(`storage-${process.env.AZURE_STORAGE_ACCOUNT}`)
            .then((secret: any) => {
              return (<AzureStorage>storage).reinitialize(process.env.AZURE_STORAGE_ACCOUNT, secret);
            })
            .catch((error: Error) => {
              console.error("Failed to reinitialize storage from Key Vault credentials");
              appInsights.errorHandler(error);
            })
            .done();
        }, Number(process.env.REFRESH_CREDENTIALS_INTERVAL) || 24 * 60 * 60 * 1000 /*daily*/);
      }

      done(null, app, storage);
    })
    .done();
}
