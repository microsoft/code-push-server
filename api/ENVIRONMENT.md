# Environment

The CodePush Server is configured using environment variables.

Currently, the following environment variables are available. For convenience, we will also load the server environment from any '.env' file in the api directory, and the test environment from any '.test.env' file in the root directory.

## Mandatory parameters

### Storage

#### Local

#### S3

- `AWS_BUCKET_NAME`: The name of your AWS S3 bucket
- `AWS_ACCESS_KEY_ID`: Your AWS access key ID
- `AWS_SECRET_ACCESS`: Your AWS secret access key
- `AWS_REGION`: The AWS region where your S3 bucket is located

### Authentication

- `SERVER_URL`: The URL of your server, for local deployment it will be either http://localhost:3000 or https://localhost:8443. For Azure it will be your Azure App URL

#### GitHub OAuth

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

#### Microsoft OAuth

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`

## Optional parameters

### HTTPS

- `HTTPS`: Set to 'true' to enable HTTPS for local deployment

### Debugging

- `LOGGING`: Turn on CodePush-specific logging of API and Storage requests. If this is insufficient, Azure Storage and Express also have their own configurable logging features.
- `DEBUG_DISABLE_AUTH`: Disable the OAuth autentication route, allowing you to make requests as anybody without authorizing. Do not set this without going through the proper channels (see section Disabling Auth)
- `DEBUG_USER_ID`: Backend id of user to behave as during the debugging session

### Redis

To enable the Redis caching layer, set:

- `REDIS_HOST`: The IP address where the Redis server is hosted (e.g.: codepush.redis.cache.windows.net)
- `REDIS_PORT`: The port which Redis is listening on (usually 6379 for HTTP and 6380 for HTTPS). Note that node_redis does not support HTTPS natively.
- `REDIS_KEY` (If authentication is enabled for Redis): The key used to authenticate requests to the Redis cache.

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
