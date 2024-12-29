// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as cookieSession from "cookie-session";
import { Request, RequestHandler, Response, Router } from "express";
import * as passport from "passport";
import * as passportBearer from "passport-http-bearer";
import * as passportGitHub from "passport-github2";
import * as passportWindowsLive from "passport-windowslive";
import * as q from "q";
import rateLimit from "express-rate-limit";

import * as restErrorUtils from "../utils/rest-error-handling";
import * as restHeaders from "../utils/rest-headers";
import * as security from "../utils/security";
import * as storage from "../storage/storage";
import * as validationUtils from "../utils/validation";
import { ServerResponse } from "http";

const passportActiveDirectory = require("passport-azure-ad");
import Promise = q.Promise;
import * as storageTypes from "../storage/storage";
import * as errorUtils from "../utils/rest-error-handling";

export interface AuthenticationConfig {
  storage: storage.Storage;
}

const DEFAULT_SESSION_EXPIRY = 1000 * 60 * 60 * 24 * 60; // 60 days

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

interface EmailAccount {
  value: string;
  type?: string;
  primary?: boolean;
}

export class PassportAuthentication {
  private static AZURE_AD_PROVIDER_NAME = "azure-ad";
  private static GITHUB_PROVIDER_NAME = "github";
  private static MICROSOFT_PROVIDER_NAME = "microsoft";

  private _cookieSessionMiddleware: RequestHandler;
  private _serverUrl: string;
  private _appServerUrl: string;
  private _storageInstance: storage.Storage;

  constructor(config: AuthenticationConfig) {
    this._serverUrl = process.env["SERVER_URL"];
    this._appServerUrl = process.env["APP_SERVER_URL"];

    // This session is neither encrypted nor signed beyond what is provided by SSL
    // By default, the 'secure' flag will be set if the node process is using SSL
    this._cookieSessionMiddleware = cookieSession({
      httpOnly: true,
      ttl: 3600000, // One hour in milliseconds
      name: "oauth.session",
      path: "/",
      signed: false,
      overwrite: true,
    });
    this._storageInstance = config.storage;

    passport.use(
      new passportBearer.Strategy((accessKey: string, done: (error: any, user?: any) => void) => {
        if (!validationUtils.isValidKeyField(accessKey)) {
          done(/*err*/ null, /*user*/ false);
          return;
        }
        this._storageInstance
          .getAccountIdFromAccessKey(accessKey)
          .then((accountId: string) => {
            done(/*err*/ null, { id: accountId });
          })
          .catch((error: storage.StorageError): void => PassportAuthentication.storageErrorHandler(error, done))
          .done();
      })
    );
  }

  public authenticate(req: Request, res: Response, next: (err?: Error) => void): void {
    passport.authenticate("bearer", { session: false }, (err: any, user: any) => {
      if (err || !user) {
        if (!err || err.code === storage.ErrorCode.NotFound) {
          res
            .status(401)
            .send(
              `The session or access key being used is invalid, please run "code-push-standalone login" again. If you are on an older version of the CLI, you may need to run "code-push-standalone logout" first to clear the session cache.`
            );
        } else if (err.code === storage.ErrorCode.Expired) {
          res
            .status(401)
            .send(
              `The session or access key being used has expired, please run "code-push-standalone login" again. If you are on an older version of the CLI, you may need to run "code-push-standalone logout" first to clear the session cache.`
            );
        } else {
          res.sendStatus(500);
          next(err);
        }
      } else {
        req.user = user;
        next();
      }
    })(req, res, next);
  }

  public getLegacyRouter(): Router {
    const router: Router = Router();
    const browserMessage: string =
      "Due to significant service improvements, your current CLI version is no longer supported." +
      "<br/>Please upgrade to the latest version by running 'npm install -g code-push-cli@latest'." +
      "<br/>Note that your end users will not be affected.";
    const cliMessage: string =
      "Due to significant service improvements, your current CLI version is no longer supported." +
      "\nPlease upgrade to the latest version by running 'npm install -g code-push-cli@latest'." +
      "\nNote that your end users will not be affected.";

    // In legacy CLI's, all commands begin by passing through a /auth endpoint
    router.all("/auth/login", (req: Request, res: Response, next: (err?: any) => void): any => {
      restErrorUtils.sendResourceGonePage(res, browserMessage);
    });

    router.all("/auth/register", (req: Request, res: Response, next: (err?: any) => void): any => {
      restErrorUtils.sendResourceGonePage(res, browserMessage);
    });

    router.use("/auth", (req: Request, res: Response, next: (err?: any) => void): any => {
      restErrorUtils.sendResourceGoneError(res, cliMessage);
    });

    return router;
  }

  public getRouter(): Router {
    const router: Router = Router();

    router.use(passport.initialize());

    router.get("/authenticated", limiter, this.authenticate, (req: Request, res: Response): any => {
      res.send({ authenticated: true });
    });

    // See https://developer.github.com/v3/oauth/ for more information.
    // GITHUB_CLIENT_ID:     The client ID you received from GitHub when registering a developer app.
    // GITHUB_CLIENT_SECRET: The client secret you received from GitHub when registering a developer app.
    const gitHubClientId: string = process.env["GITHUB_CLIENT_ID"];
    const gitHubClientSecret: string = process.env["GITHUB_CLIENT_SECRET"];
    const isGitHubAuthenticationEnabled: boolean = !!this._serverUrl && !!gitHubClientId && !!gitHubClientSecret;

    if (isGitHubAuthenticationEnabled) {
      this.setupGitHubRoutes(router, gitHubClientId, gitHubClientSecret);
    }

    // See https://msdn.microsoft.com/en-us/library/hh243649.aspx for more information.
    // MICROSOFT_CLIENT_ID:     The client ID you received from Microsoft when registering an app.
    // MICROSOFT_CLIENT_SECRET: The client secret you received from Microsoft when registering an app.
    const microsoftClientId: string = process.env["MICROSOFT_CLIENT_ID"];
    const microsoftClientSecret: string = process.env["MICROSOFT_CLIENT_SECRET"];
    const isMicrosoftAuthenticationEnabled: boolean = !!this._serverUrl && !!microsoftClientId && !!microsoftClientSecret;

    if (isMicrosoftAuthenticationEnabled) {
      this.setupMicrosoftRoutes(router, microsoftClientId, microsoftClientSecret);
      this.setupAzureAdRoutes(router, microsoftClientId, microsoftClientSecret);
    }

    router.get("/auth/login", this._cookieSessionMiddleware, (req: Request, res: Response): any => {
      req.session["hostname"] = req.query.hostname;
      res.render("authenticate", {
        action: "login",
        isGitHubAuthenticationEnabled,
        isMicrosoftAuthenticationEnabled,
      });
    });

    router.get("/auth/link", this._cookieSessionMiddleware, (req: Request, res: Response): any => {
      req.session["authorization"] = req.query.access_token;
      res.render("authenticate", {
        action: "link",
        isGitHubAuthenticationEnabled,
        isMicrosoftAuthenticationEnabled,
      });
    });

    router.get("/auth/register", this._cookieSessionMiddleware, (req: Request, res: Response): any => {
      req.session["hostname"] = req.query.hostname;
      res.render("authenticate", {
        action: "register",
        isGitHubAuthenticationEnabled,
        isMicrosoftAuthenticationEnabled,
      });
    });

    return router;
  }

  public getAppRouter(): Router {
    const router: Router = Router();

    router.use(passport.initialize());

    /**
     * @openapi
     * /app/authenticated:
     *   get:
     *     summary: Check if the user is authenticated
     *     description: Returns a boolean indicating if the user is authenticated.
     *     responses:
     *       200:
     *         description: User is authenticated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 authenticated:
     *                   type: boolean
     *                   example: true
     *       401:
     *         description: Unauthorized access
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    router.get("/authenticated", limiter, this.authenticate, (req: Request, res: Response): any => {
      res.send({ authenticated: true });
    });

    const appGitHubClientId: string = process.env["APP_GITHUB_CLIENT_ID"];
    const appGitHubClientSecret: string = process.env["APP_GITHUB_CLIENT_SECRET"];
    const isAppGitHubAuthenticationEnabled: boolean = !!this._appServerUrl && !!appGitHubClientId && !!appGitHubClientSecret;

    if (isAppGitHubAuthenticationEnabled) {
      this.setupAppGitHubRoutes(router, appGitHubClientId, appGitHubClientSecret);
    }

    return router;
  }

  private static getEmailAddress(user: passport.Profile): string {
    const emailAccounts: EmailAccount[] = user.emails;

    if (!emailAccounts || emailAccounts.length === 0) {
      return (<any>user)?._json?.email || (<any>user)?._json?.preferred_username || (<any>user).oid; // This is the format used by passport-azure-ad
    }

    let emailAddress: string;
    for (let i = 0; i < emailAccounts.length; ++i) {
      const emailAccount: EmailAccount = emailAccounts[i];

      if (emailAccount.primary) {
        return emailAccount.value;
      }

      emailAddress = emailAccount.value;
    }

    return emailAddress;
  }

  public static isAccountRegistrationEnabled(): boolean {
    const value: string = process.env["ENABLE_ACCOUNT_REGISTRATION"] || "true";

    return value.toLowerCase() === "true";
  }

  private static storageErrorHandler(error: storage.StorageError, done: (err: any, user: any) => void): void {
    if (error.code === storage.ErrorCode.NotFound) {
      done(/*error=*/ null, /*user=*/ false);
    } else {
      done(error, /*user=*/ false);
    }
  }

  private static getProviderId(account: storage.Account, provider: string): string {
    switch (provider) {
      case PassportAuthentication.AZURE_AD_PROVIDER_NAME:
        return account.azureAdId;
      case PassportAuthentication.GITHUB_PROVIDER_NAME:
        return account.gitHubId;
      case PassportAuthentication.MICROSOFT_PROVIDER_NAME:
        return account.microsoftId;
      default:
        throw new Error("Unrecognized provider");
    }
  }

  private static setProviderId(account: storage.Account, provider: string, id: string): void {
    switch (provider) {
      case PassportAuthentication.AZURE_AD_PROVIDER_NAME:
        account.azureAdId = id;
        return;
      case PassportAuthentication.GITHUB_PROVIDER_NAME:
        account.gitHubId = id;
        return;
      case PassportAuthentication.MICROSOFT_PROVIDER_NAME:
        account.microsoftId = id;
        return;
      default:
        throw new Error("Unrecognized provider");
    }
  }

  private setupAppCommonRoutes(router: Router, providerName: string, strategyName: string): void {

    /**
       * @openapi
       * /app/auth/logout:
       *   get:
       *     summary: Logout the user
       *     description: Logs out the user by invalidating the access key and clearing the session.
       *     parameters:
       *       - in: query
       *         name: accessKeyId
       *         required: false
       *         schema:
       *           type: string
       *         description: The access key ID to be invalidated
       *     responses:
       *       200:
       *         description: Successfully logged out
       *         content:
       *           application/json:
       *             schema:
       *               type: object
       *               properties:
       *                 result:
       *                   type: string
       *                   example: success
       *       401:
       *         description: Unauthorized access
       *       500:
       *         description: Internal server error
       */
    router.get("/auth/logout", this._cookieSessionMiddleware, (req: Request, res: Response, next: (err?: any) => void): any => {
      passport.authenticate("bearer", { session: false }, (err: any, user: any) => {
        if (err || !user) {
          restErrorUtils.sendRestUnknownError(res, new Error(`something went wrong`), next);
        } else {
          const { id: accountId } = user;
          const accessKeyId = req.session.accessKeyId || req.query.accessKeyId;

          this._storageInstance
            .removeAccessKey(accountId, accessKeyId)
            .then(() => {
              req.session = null;
              res.send({ result: "success" });
            })
            .catch((error) => {
              req.session = null;
              errorUtils.restErrorHandler(res, error, next);
            })
            .done();
        }
      })(req, res, next);
    });

    /**
     * @openapi
     * /app/auth/login/github:
     *   get:
     *     summary: Initiate login with HitHub
     *     description: Initiates the login process with GitHub provider.
     *     responses:
     *       200:
     *         description: Login initiated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 location:
     *                   type: string
     *                   description: The URL to redirect the user to for authentication
     *                 statusCode:
     *                   type: integer
     *                   description: The HTTP status code
     *                 action:
     *                   type: string
     *                   description: The action being performed ("login")
     *       401:
     *         description: Unauthorized access
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    router.get(
      "/auth/login/" + providerName,
      limiter,
      // TODO add CORS to allow ro call from the app only
      // https://expressjs.com/en/resources/middleware/cors.html`
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        req.session["action"] = "login";
        //https://stackoverflow.com/questions/68785664/prevent-automatic-redirect-and-get-redirect-url-of-passportjs-authenticate-met
        const wrappedResponse = new ServerResponse(req);
        passport.authenticate(strategyName, { session: false })(req, wrappedResponse, next);

        res.send({
          location: wrappedResponse.getHeader("Location"),
          statusCode: wrappedResponse.statusCode,
          action: "login",
        });
      }
    );

    /**
     * @openapi
     * /app/auth/register/github:
     *   get:
     *     summary: Initiate register with the GitHub
     *     description: Initiates the register process with GitHub provider.
     *     responses:
     *       200:
     *         description: Redgister initiated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 location:
     *                   type: string
     *                   description: The URL to redirect the user to for authentication
     *                 statusCode:
     *                   type: integer
     *                   description: The HTTP status code
     *                 action:
     *                   type: string
     *                   description: The action being performed
     *       401:
     *         description: Unauthorized access
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    router.get(
      "/auth/register/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      // TODO add CORS to allow to call from the app only
      // https://expressjs.com/en/resources/middleware/cors.html
      (req: Request, res: Response, next: (err?: any) => void): any => {
        //TODO
        /*        if (!PassportAuthentication.isAccountRegistrationEnabled()) {
                                                                                                                                                                                                                                                                                                                                                  restErrorUtils.sendForbiddenError(res);
                                                                                                                                                                                                                                                                                                                                                  return;
                                                                                                                                                                                                                                                                                                                                                }*/

        req.session["action"] = "register";

        //https://stackoverflow.com/questions/68785664/prevent-automatic-redirect-and-get-redirect-url-of-passportjs-authenticate-met
        const wrappedResponse = new ServerResponse(req);
        passport.authenticate(strategyName, { session: false })(req, wrappedResponse, next);

        res.send({
          location: wrappedResponse.getHeader("Location"),
          statusCode: wrappedResponse.statusCode,
          action: "register",
        });
      }
    );

    router.get(
      "/auth/link/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        req.session["action"] = "link";

        //https://stackoverflow.com/questions/68785664/prevent-automatic-redirect-and-get-redirect-url-of-passportjs-authenticate-met
        const wrappedResponse = new ServerResponse(req);
        passport.authenticate(strategyName, { session: false })(req, wrappedResponse, next);

        res.send({
          location: wrappedResponse.getHeader("Location"),
          statusCode: wrappedResponse.statusCode,
          action: "link",
        });
      }
    );

    /**
     * @openapi
     * /app/auth/callback/github:
     *   get:
     *     summary: Handle OAuth callback
     *     description: Issue app token for the authenticated user.
     *     parameters:
     *       - in: query
     *         name: code
     *         required: true
     *         schema:
     *           type: string
     *         description: The authorization code received from the OAuth provider
     *       - in: query
     *         name: state
     *         required: true
     *         schema:
     *           type: string
     *         description: The state parameter to prevent CSRF attacks
     *     responses:
     *       200:
     *         description: Callback handled successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 accessKey:
     *                   type: string
     *                   description: The access key for the authenticated user
     *       401:
     *         description: Unauthorized access
     *       403:
     *         description: Forbidden access
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    router.get(
      "/auth/callback/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        const auth = passport.authenticate(strategyName, {
          // TODO play with this redirect. It should be the app url?
          failureRedirect: "/auth/login/" + providerName,
          session: false,
        });

        auth(req, res, next);
      },
      (req: Request, res: Response, next: (err?: any) => void): any => {
        const action: string = req.session["action"];
        const hostname: string = req.session["hostname"];
        const user: passport.Profile = req.user;

        //TODO think about disabled registration on the app.
        /*        if (action === "register" && !PassportAuthentication.isAccountRegistrationEnabled()) {
                                                                                                                                                                                                                                                                                  restErrorUtils.sendForbiddenError(res);
                                                                                                                                                                                                                                                                                  return;
                                                                                                                                                                                                                                                                                }*/

        const emailAddress: string = PassportAuthentication.getEmailAddress(user);
        if (!emailAddress && providerName === PassportAuthentication.MICROSOFT_PROVIDER_NAME) {
          const message: string =
            "You've successfully signed in your Microsoft account, but we couldn't get an email address from it." +
            "<br/>Please fill the basic information (i.e. First/Last name, Email address) for your Microsoft account in case of absence, then try to run 'code-push-standalone login' again.";
          restErrorUtils.sendRestForbiddenError(res, message);
          return;
        } else if (!emailAddress) {
          restErrorUtils.sendRestUnknownError(
            res,
            new Error(`Couldn't get an email address from the ${providerName} OAuth provider for user ${JSON.stringify(user)}`),
            next
          );
          return;
        }

        // TODO: do not
        const issueAccessKey = (accountId: string): Promise<void> => {
          const now: number = new Date().getTime();
          const friendlyName: string = `Login-${now}`;
          const accessKey: storage.AccessKey = {
            name: security.generateSecureKey(accountId),
            createdTime: now,
            createdBy: hostname || restHeaders.getIpAddress(req),
            description: friendlyName,
            expires: now + DEFAULT_SESSION_EXPIRY,
            friendlyName: friendlyName,
            isSession: true,
          };

          return this._storageInstance.addAccessKey(accountId, accessKey).then((accessKeyId: string): void => {
            req.session.accessKeyId = accessKeyId;
            res.send({ accessKey: accessKey.name, accessKeyId: accessKeyId });
          });
        };

        this._storageInstance
          .getAccountByEmail(emailAddress)
          .then(
            (account: storage.Account): void | Promise<void> => {
              const existingProviderId: string = PassportAuthentication.getProviderId(account, providerName);
              const isProviderValid: boolean = existingProviderId === user.id;
              switch (action) {
                case "register":
                  const message: string = isProviderValid
                    ? "You are already registered with the service using this authentication provider.<br/>Please cancel the registration process (Ctrl-C) on the CLI and login with your account."
                    : "You are already registered with the service using a different authentication provider." +
                      "<br/>Please cancel the registration process (Ctrl-C) on the CLI and login with your registered account." +
                      "<br/>Once logged in, you can optionally link this provider to your account.";
                  restErrorUtils.sendRestAlreadyExistsError(res, message);
                  return;
                case "link":
                  if (existingProviderId) {
                    restErrorUtils.sendRestAlreadyExistsError(res, "You are already registered with the service using this provider.");
                    return;
                  }

                  PassportAuthentication.setProviderId(account, providerName, user.id);
                  return this._storageInstance.updateAccount(account.email, account).then(() => {
                    const message =
                      "You have successfully linked your account!<br/>You will now be able to use this provider to authenticate in the future.<br/>Please return to the CLI to continue.";
                    res.send({ message: message });
                  });
                case "login":
                  if (!isProviderValid) {
                    restErrorUtils.sendRestForbiddenError(res, "You are not registered with the service using this provider account.");
                    return;
                  }

                  return issueAccessKey(account.id);
                default:
                  restErrorUtils.sendRestUnknownError(res, new Error(`Unrecognized action (${action})`), next);
                  return;
              }
            },
            (error: storage.StorageError): void | Promise<void> => {
              if (error.code !== storage.ErrorCode.NotFound) throw error;

              switch (action) {
                case "login":
                  const message: string = PassportAuthentication.isAccountRegistrationEnabled()
                    ? "Account not found.<br/>Have you registered with the CLI?<br/>If you are registered but your email address has changed, please contact us."
                    : "Account not found.<br/>Please <a href='http://microsoft.github.io/code-push/'>sign up for the beta</a>, and we will contact you when your account has been created!</a>";
                  restErrorUtils.sendRestForbiddenError(res, message);
                  return;
                case "link":
                  restErrorUtils.sendRestForbiddenError(
                    res,
                    "We weren't able to link your account, because the primary email address registered with your provider does not match the one on your CodePush account." +
                      "<br/>Please use a matching email address, or contact us if you'd like to change the email address on your CodePush account."
                  );
                  return;
                case "register":
                  const newUser: storage.Account = {
                    createdTime: new Date().getTime(),
                    email: emailAddress,
                    name: user.displayName,
                  };
                  PassportAuthentication.setProviderId(newUser, providerName, user.id);

                  return this._storageInstance
                    .addAccount(newUser)
                    .then((accountId: string): Promise<void> => issueAccessKey(accountId));
                default:
                  restErrorUtils.sendRestUnknownError(res, new Error(`Unrecognized action (${action})`), next);
                  return;
              }
            }
          )
          .catch((error: storage.StorageError): void => {
            error.message = `Unexpected failure with action ${action}, provider ${providerName}, email ${emailAddress}, and message: ${error.message}`;
            restErrorUtils.sendRestUnknownError(res, error, next);
          })
          .done();
      }
    );
  }

  private setupCommonRoutes(router: Router, providerName: string, strategyName: string): void {
    router.get(
      "/auth/login/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        req.session["action"] = "login";

        passport.authenticate(strategyName, { session: false })(req, res, next);
      }
    );

    router.get(
      "/auth/register/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        if (!PassportAuthentication.isAccountRegistrationEnabled()) {
          restErrorUtils.sendForbiddenError(res);
          return;
        }

        req.session["action"] = "register";

        passport.authenticate(strategyName, { session: false })(req, res, next);
      }
    );

    router.get(
      "/auth/link/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      (req: Request, res: Response, next: (err?: any) => void): any => {
        req.session["action"] = "link";

        passport.authenticate(strategyName, { session: false })(req, res, next);
      }
    );

    router.get(
      "/auth/callback/" + providerName,
      limiter,
      this._cookieSessionMiddleware,
      passport.authenticate(strategyName, { failureRedirect: "/auth/login/" + providerName, session: false }),
      (req: Request, res: Response, next: (err?: any) => void): any => {
        const action: string = req.session["action"];
        const hostname: string = req.session["hostname"];
        const user: passport.Profile = req.user;

        if (action === "register" && !PassportAuthentication.isAccountRegistrationEnabled()) {
          restErrorUtils.sendForbiddenError(res);
          return;
        }

        const emailAddress: string = PassportAuthentication.getEmailAddress(user);
        if (!emailAddress && providerName === PassportAuthentication.MICROSOFT_PROVIDER_NAME) {
          const message: string =
            "You've successfully signed in your Microsoft account, but we couldn't get an email address from it." +
            "<br/>Please fill the basic information (i.e. First/Last name, Email address) for your Microsoft account in case of absence, then try to run 'code-push-standalone login' again.";
          restErrorUtils.sendForbiddenPage(res, message);
          return;
        } else if (!emailAddress) {
          restErrorUtils.sendUnknownError(
            res,
            new Error(`Couldn't get an email address from the ${providerName} OAuth provider for user ${JSON.stringify(user)}`),
            next
          );
          return;
        }

        const issueAccessKey = (accountId: string): Promise<void> => {
          const now: number = new Date().getTime();
          const friendlyName: string = `Login-${now}`;
          const accessKey: storage.AccessKey = {
            name: security.generateSecureKey(accountId),
            createdTime: now,
            createdBy: hostname || restHeaders.getIpAddress(req),
            description: friendlyName,
            expires: now + DEFAULT_SESSION_EXPIRY,
            friendlyName: friendlyName,
            isSession: true,
          };

          return this._storageInstance.addAccessKey(accountId, accessKey).then((accessKeyId: string): void => {
            const key: string = accessKey.name;
            req.session["accessKey"] = key;
            req.session["isNewAccount"] = action === "register";

            res.redirect("/accesskey");
          });
        };

        this._storageInstance
          .getAccountByEmail(emailAddress)
          .then(
            (account: storage.Account): void | Promise<void> => {
              const existingProviderId: string = PassportAuthentication.getProviderId(account, providerName);
              const isProviderValid: boolean = existingProviderId === user.id;
              switch (action) {
                case "register":
                  const message: string = isProviderValid
                    ? "You are already registered with the service using this authentication provider.<br/>Please cancel the registration process (Ctrl-C) on the CLI and login with your account."
                    : "You are already registered with the service using a different authentication provider." +
                      "<br/>Please cancel the registration process (Ctrl-C) on the CLI and login with your registered account." +
                      "<br/>Once logged in, you can optionally link this provider to your account.";
                  restErrorUtils.sendAlreadyExistsPage(res, message);
                  return;
                case "link":
                  if (existingProviderId) {
                    restErrorUtils.sendAlreadyExistsPage(res, "You are already registered with the service using this provider.");
                    return;
                  }

                  PassportAuthentication.setProviderId(account, providerName, user.id);
                  return this._storageInstance.updateAccount(account.email, account).then(() => {
                    res.render("message", {
                      message:
                        "You have successfully linked your account!<br/>You will now be able to use this provider to authenticate in the future.<br/>Please return to the CLI to continue.",
                    });
                  });
                case "login":
                  if (!isProviderValid) {
                    restErrorUtils.sendForbiddenPage(res, "You are not registered with the service using this provider account.");
                    return;
                  }

                  return issueAccessKey(account.id);
                default:
                  restErrorUtils.sendUnknownError(res, new Error(`Unrecognized action (${action})`), next);
                  return;
              }
            },
            (error: storage.StorageError): void | Promise<void> => {
              if (error.code !== storage.ErrorCode.NotFound) throw error;

              switch (action) {
                case "login":
                  const message: string = PassportAuthentication.isAccountRegistrationEnabled()
                    ? "Account not found.<br/>Have you registered with the CLI?<br/>If you are registered but your email address has changed, please contact us."
                    : "Account not found.<br/>Please <a href='http://microsoft.github.io/code-push/'>sign up for the beta</a>, and we will contact you when your account has been created!</a>";
                  restErrorUtils.sendForbiddenPage(res, message);
                  return;
                case "link":
                  restErrorUtils.sendForbiddenPage(
                    res,
                    "We weren't able to link your account, because the primary email address registered with your provider does not match the one on your CodePush account." +
                      "<br/>Please use a matching email address, or contact us if you'd like to change the email address on your CodePush account."
                  );
                  return;
                case "register":
                  const newUser: storage.Account = {
                    createdTime: new Date().getTime(),
                    email: emailAddress,
                    name: user.displayName,
                  };
                  PassportAuthentication.setProviderId(newUser, providerName, user.id);

                  return this._storageInstance
                    .addAccount(newUser)
                    .then((accountId: string): Promise<void> => issueAccessKey(accountId));
                default:
                  restErrorUtils.sendUnknownError(res, new Error(`Unrecognized action (${action})`), next);
                  return;
              }
            }
          )
          .catch((error: storage.StorageError): void => {
            error.message = `Unexpected failure with action ${action}, provider ${providerName}, email ${emailAddress}, and message: ${error.message}`;
            restErrorUtils.sendUnknownError(res, error, next);
          })
          .done();
      }
    );

    router.get("/accesskey", limiter, this._cookieSessionMiddleware, (req: Request, res: Response): any => {
      const accessKey: string = req.session["accessKey"];
      const isNewAccount: boolean = req.session["isNewAccount"];

      req.session = null;

      res.render("accesskey", { accessKey: accessKey, isNewAccount: isNewAccount });
    });
  }

  private getCallbackUrl(providerName: string): string {
    return `${this._serverUrl}/auth/callback/${providerName}`;
  }

  private setupAppGitHubRoutes(router: Router, gitHubClientId: string, gitHubClientSecret: string): void {
    const providerName = PassportAuthentication.GITHUB_PROVIDER_NAME;
    const strategyName = "appgithub";
    const options: passportGitHub.StrategyOptions = {
      clientID: gitHubClientId,
      clientSecret: gitHubClientSecret,
      callbackURL: `${this._appServerUrl}/auth/callback/${providerName}`,
      scope: ["user:email"],
      state: true, // to apply the state parameter in URI. In newer verso of pasport string value is accepted ("state" ??).
    };

    passport.use(
      strategyName,
      new passportGitHub.Strategy(
        options,
        (accessToken: string, refreshToken: string, profile: passportGitHub.Profile, done: (err?: any, user?: any) => void): void => {
          done(/*err*/ null, profile);
        }
      )
    );

    this.setupAppCommonRoutes(router, providerName, strategyName);
  }

  private setupGitHubRoutes(router: Router, gitHubClientId: string, gitHubClientSecret: string): void {
    const providerName = PassportAuthentication.GITHUB_PROVIDER_NAME;
    const strategyName = "github";
    const options: passportGitHub.StrategyOptions = {
      clientID: gitHubClientId,
      clientSecret: gitHubClientSecret,
      callbackURL: this.getCallbackUrl(providerName),
      scope: ["user:email"],
      state: true,
    };

    passport.use(
      new passportGitHub.Strategy(
        options,
        (accessToken: string, refreshToken: string, profile: passportGitHub.Profile, done: (err?: any, user?: any) => void): void => {
          done(/*err*/ null, profile);
        }
      )
    );

    this.setupCommonRoutes(router, providerName, strategyName);
  }

  private setupMicrosoftRoutes(router: Router, microsoftClientId: string, microsoftClientSecret: string): void {
    const providerName = PassportAuthentication.MICROSOFT_PROVIDER_NAME;
    const strategyName = "windowslive";
    const options: passportWindowsLive.IStrategyOptions = {
      clientID: microsoftClientId,
      clientSecret: microsoftClientSecret,
      callbackURL: this.getCallbackUrl(providerName),
      scope: ["wl.signin", "wl.emails"],
      state: true,
    };

    passport.use(
      new passportWindowsLive.Strategy(
        options,
        (accessToken: string, refreshToken: string, profile: passport.Profile, done: (error: any, user: any) => void): void => {
          done(/*err*/ null, profile);
        }
      )
    );

    this.setupCommonRoutes(router, providerName, strategyName);
  }

  private setupAzureAdRoutes(router: Router, microsoftClientId: string, microsoftClientSecret: string): void {
    const providerName = PassportAuthentication.AZURE_AD_PROVIDER_NAME;
    const strategyName = "azuread-openidconnect";
    const options: any = {
      redirectUrl: this.getCallbackUrl(providerName),
      clientID: microsoftClientId,
      clientSecret: microsoftClientSecret,
      identityMetadata: `https://login.microsoftonline.com/${
        process.env["MICROSOFT_TENANT_ID"] || "common"
      }/v2.0/.well-known/openid-configuration`,
      responseMode: "query",
      responseType: "code",
      scope: ["email", "profile"],
      skipUserProfile: true, // Should be set to true for Azure AD
      validateIssuer: false, // We allow AD authentication across multiple tenants
      allowHttpForRedirectUrl: true,
    };

    passport.use(
      new passportActiveDirectory.OIDCStrategy(
        options,
        (
          iss: string,
          sub: string,
          profile: passport.Profile,
          accessToken: string,
          refreshToken: string,
          done: (error: any, user: any) => void
        ) => {
          done(/*err*/ null, profile);
        }
      )
    );

    this.setupCommonRoutes(router, providerName, strategyName);
  }
}
