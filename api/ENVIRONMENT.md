# Environment

The CodePush Server is configured using environment variables.

For convenience, we will also load the server environment from any '.env' file in the api directory, and the test environment from any '.test.env' file in the root directory. Use the `.env.example` file as a template for setting up your environment variables.

## Mandatory parameters

### Storage

#### Local

### Authentication

- `SERVER_URL`: The URL of your server, for local deployment it will be either <http://localhost:3000> or <https://localhost:8443>.

#### GitHub OAuth

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Optional parameters

### HTTPS

- `HTTPS`: Set to 'true' to enable HTTPS for local deployment

### Debugging

- `LOGGING`: Turn on CodePush-specific logging of API and Storage requests. If this is insufficient, Express also has their own configurable logging features.
- `DEBUG_DISABLE_AUTH`: Set to 'true' to skip authentication and impersonate existing user. When set, server uses `DEBUG_USER_ID` as logged in user for all requests requiring authentication.
- `DEBUG_USER_ID`: Backend id of existing user to impersonate when `DEBUG_DISABLE_AUTH` is set to 'true'. Default value: 'default'.

### Redis

To enable the Redis caching layer, set:

- `REDIS_URL`: The URL of your Redis server

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
