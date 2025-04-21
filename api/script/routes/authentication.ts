import { OAuth2Client, TokenPayload } from "google-auth-library";
import * as cookieSession from "cookie-session";
import { Request, Response, Router, RequestHandler } from "express";
import * as storage from "../storage/storage";
import rateLimit from "express-rate-limit";
import { sendErrorToDatadog } from "../utils/tracer";

// Replace with your actual Google Client ID (from Google Developer Console)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "<Your Google Client ID>";
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface AuthenticationConfig {
  storage: storage.Storage;
}

export class Authentication {
  private _cookieSessionMiddleware: RequestHandler;
  private _serverUrl: string;
  private _storageInstance: storage.Storage;

  constructor(config: AuthenticationConfig) {
    this._serverUrl = process.env["SERVER_URL"];

    // Session middleware setup
    this._cookieSessionMiddleware = cookieSession({
      httpOnly: true,
      ttl: 3600000, // One hour in milliseconds
      name: "oauth.session",
      path: "/",
      signed: false,
      overwrite: true,
    });

    this._storageInstance = config.storage;
  }

  // Validate the Google ID token received from the client or web dashboard
  public async verifyGoogleToken(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: GOOGLE_CLIENT_ID, // Make sure this matches the client ID used in your app
      });

      const payload = ticket.getPayload();
      return payload; // Return the user info from Google token
    } catch (error) {
      sendErrorToDatadog(new Error("401: Unauthorised Invalid Google Token"));
      throw new Error("Invalid Google token");
    }
  }

  public async getOrCreateUser(payload: TokenPayload): Promise<storage.Account> {
    try {
      return await this._storageInstance.getAccountByEmail(payload.email);
    } catch (e) {
      await this._storageInstance.addAccount({
        createdTime: Date.now(),
        email: payload.email,
        name: payload.name,
      });
      return await this._storageInstance.getAccountByEmail(payload.email);
    }
  }

  public async getUserById(userId: string): Promise<storage.Account> {
    try {
      return await this._storageInstance.getAccount(userId);
    } catch (e) {
      sendErrorToDatadog(new Error("403: User Not found"));
      throw new Error("No User found");
    }
  }

  // Middleware to authenticate requests using Google ID token
  public async authenticate(req: Request, res: Response, next: (err?: Error) => void) {
    // Bypass authentication in development mode
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      // Extract token from auth header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        
        // Use the token to find the account
        // First check if the key exists and is not expired
    this._storageInstance.isAccessKeyValid(token)
    .then(isValid => {
      if (!isValid) {
        // For expired or invalid keys, return 401 directly
        res.status(401).send("Access key has expired or is invalid");
        return;
      }
      
      // If key is valid, get the associated account
      return this._storageInstance.getAccountIdFromAccessKey(token)
        .then(accountId => {
          req.user = { id: accountId };
          next();
        });
    })
    .catch(() => {
      // Only fall back to default for missing Authorization header
      req.user = { id: "id_0" };
      next();
    });
    return; // Important to prevent next() being called twice
      } else {
        req.user = req.headers.userId;
      }
      return next();
    }

    // In production, validate the Google ID token
    try {
      const idToken = req.headers.authorization?.split("Bearer ")[1];
      if (!idToken) {
        const userId = Array.isArray(req.headers.userid) ? req.headers.userid[0] : req.headers.userid;
        if (userId) {
            const user = await this.getUserById(userId);
            if (user) {
                req.user = {
                  id: userId
                };
                return next();
            } else {
                return res.status(401).send("User not found");    
            }
        } else {
            return res.status(401).send("Missing Google ID token");
        }
        
    }

    if (idToken.startsWith("cli-")) {
      // Handle CLI access with access key
        const accessToken = idToken.split("cli-")[1];
        const user = await this._storageInstance.getUserFromAccessToken(accessToken);
        if(user) {
          req.user = { id: user.id };
          return next();
        } else {
          return res.status(401).send("Authentication failed by access key");
        }
    } else {

        // Verify Google ID token
        const payload = await this.verifyGoogleToken(idToken);
        if (!payload) {
          return res.status(401).send("Invalid Google ID token");
        }

        // Check user exists in the storage
        const userEmail = payload.email;

        const user = await this.getOrCreateUser(payload);

        if (!user) {
          return res.status(401).send("User not found in the system");
        } else {
          // Update user info if it has changed
          if (user.name !== payload.name) {
            user.name = payload.name;
            await this._storageInstance.addAccount(user);
            //return this._storageInstance
            // .addAccount(newUser)
            // .then((accountId: string): Promise<void> => issueAccessKey(accountId));
          }
        }

        // Attach the user to the request object
        req.user = user;
        next();
    }

     
    } catch (error) {
      res.status(401).send("Authentication failed");
    }
  }

  // Main router for handling requests
  public getRouter(): Router {
    const router: Router = Router();

    router.use(this._cookieSessionMiddleware);

    // Example protected route
    router.get(
      "/authenticated",
      rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }),
      this.authenticate.bind(this),
      (req: Request, res: Response) => {
        res.send({ authenticated: true, user: req.user });
      }
    );

    return router;
  }
}
