# Environment

The CodePush Server is configured using environment variables.

For convenience, we will also load the server environment from any '.env' file in the api directory, and the test environment from any '.test.env' file in the root directory. Use the `.env.example` file as a template for setting up your environment variables.

## Mandatory parameters

### Storage

#### Local

To emulate Azure Blob Storage locally. Azurite needs to be installed and running, more info [here](README.md#local).
- `EMULATED`: Set to 'true' in order to use the local emulator instead of a hosted instance

#### Azure
- `AZURE_STORAGE_ACCOUNT`: The name of your hosted Azure storage instance
- `AZURE_STORAGE_ACCESS_KEY`: The key to your Azure storage instance (if KeyVault credentials are not provided)

### Authentication 

- `SERVER_URL`: The URL of your server, for local deployment it will be either http://localhost:3000 or https://localhost:8443. For Azure it will be your Azure App URL

#### GitHub OAuth 

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

#### Microsoft OAuth

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`: Required if application registration is single tenant.

## Optional parameters

### HTTPS
- `HTTPS`: Set to 'true' to enable HTTPS for local deployment

### Debugging

- `LOGGING`: Turn on CodePush-specific logging of API and Storage requests. If this is insufficient, Azure Storage and Express also have their own configurable logging features.
- `DEBUG_DISABLE_AUTH`: Set to 'true' to skip authentication and impersonate existing user. When set, server uses `DEBUG_USER_ID` as logged in user for all requests requiring authentication.
- `DEBUG_USER_ID`: Backend id of existing user to impersonate when `DEBUG_DISABLE_AUTH` is set to 'true'. Default value: 'default'. 

### Redis
To enable the Redis caching layer, set:

- `REDIS_HOST`: The IP address where the Redis server is hosted (e.g.: codepush.redis.cache.windows.net)
- `REDIS_PORT`: The port which Redis is listening on (usually 6379 for HTTP and 6380 for HTTPS). Note that node_redis does not support HTTPS natively.
- `REDIS_KEY` (If authentication is enabled for Redis): The key used to authenticate requests to the Redis cache.

### Unit testing
To perform the unit tests against Azure storage:

- `TEST_AZURE_STORAGE`: (For unit tests) Set to 'true' in order to run API unit tests against Azure storage (instead of mocked JSON storage). Note that outside of the test environment, we will always run against Azure storage regardless.
- `AZURE_STORAGE_ACCOUNT`: (For unit tests) If TEST_AZURE_STORAGE is set to true, set to the account of the storage you would like to test on.
- `AZURE_STORAGE_ACCESS_KEY`: (For unit tests) If TEST_AZURE_STORAGE is set to true, set to the access key of the storage you would like to test on.

To perform the unit tests against an Azure server:

- `AZURE_MANAGEMENT_URL`: (For unit tests) Set to an Azure url to run management tests against that server. If the server has authentication enabled, also set the TEST_AZURE_STORAGE and AZURE_STORAGE_ACCESS_KEY to the Azure storage used by the server so that the tests can pass authentication.
- `AZURE_ACQUISITION_URL`: (For unit tests) Set to an Azure url to run acquisition tests against that server. If the server has authentication enabled, also set the TEST_AZURE_STORAGE and AZURE_STORAGE_ACCESS_KEY to the Azure storage used by the server so that the tests can pass authentication.

### Other

- `DISABLE_ACQUISITION`: Set to 'true' to disable acquisition routes
- `DISABLE_MANAGEMENT`: Set to 'true' to disable management routes
- `ENABLE_ACCOUNT_REGISTRATION`: Set to 'false' in order to disable account registration
- `TIMEOUT`: (For unit tests) Set to a number (in ms) to override the default mocha timeout
- `APP_INSIGHTS_INSTRUMENTATION_KEY`: Set to the App Insights Instrumentation Key to enable telemetry
- `LOG_INVALID_JSON_REQUESTS`: Set to 'true' to log raw request data to AppInsights when JSON parsing errors occur.
- `UPLOAD_SIZE_LIMIT_MB`: Set to the max number of megabytes allowed for file uploads. Defaults to 200 if unspecified.

To enable generating diffs for releases:

- `ENABLE_PACKAGE_DIFFING`: Set to 'true'

To enable KeyVault credential resolution, set:

- `AZURE_KEYVAULT_ACCOUNT`: The name of your hosted Azure KeyVault account
- `CLIENT_ID`: The client ID of an Active Directory app that has access to your KeyVault account
- `CERTIFICATE_THUMBPRINT`: The thumbprint of the certificate associated with your Active Directory app (for which a .pfx has been uploaded to your certificate store)
- `REFRESH_CREDENTIALS_INTERVAL` (Optional): The frequency, in milliseconds, to re-retrieve credentials from Key Vault (defaults to one day, currently only storage keys are supported)
