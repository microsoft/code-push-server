# CodePush Server

The CodePush Server is a Node.js application that powers the CodePush Service. It allows users to deploy and manage over-the-air updates for their react-native applications in a self-hosted environment.

Please refer to [react-native-code-push](https://github.com/microsoft/react-native-code-push) for instructions on how to onboard your application to CodePush.

## Deployment

### Local

#### Steps

To run the CodePush Server locally, follow these steps:

1. Clone the CodePush Service repository to your local machine.

2. Copy the `.env.example` file to a new file named `.env` in the root directory:

   ```bash
   cp .env.example .env
   ```

   Fill in the values for each environment variable in the `.env` file according to your development or production setup.

3. Install all necessary dependencies:

   ```bash

   npm install
   ```

4. Compile the server code:

   ```bash

   npm run build
   ```

5. Launch the server with the environment-specific start command:

   ```bash

   npm run start:env
   ```

By default, local CodePush server runs on HTTP. To run CodePush Server on HTTPS:

1. Create a `certs` directory and place `cert.key` (private key) and `cert.crt` (certificate) files there.
2. Set environment variable [HTTPS](./ENVIRONMENT.md#https) to true.

For more detailed instructions and configuration options, please refer to the [ENVIRONMENT.md](./ENVIRONMENT.md) file.

#### Prerequisites

For user authentication, a GitHub OAuth application is needed.
More detailed instructions on how to set up one can be found in the section [OAuth Apps](#oauth-apps).

#### Steps

## Configure react-native-code-push

In order for [react-native-code-push](https://github.com/microsoft/react-native-code-push) to use your server, additional configuration value is needed.

### Android

in `strings.xml`, add following line, replacing `server-url` with your server.

```xml
<string moduleConfig="true" name="CodePushServerUrl">server-url</string>
```

### iOS

in `Info.plist` file, add following lines, replacing `server-url` with your server.

```plist
<key>CodePushServerURL</key>
<string>server-url</string>
```

## OAuth apps

CodePush uses GitHub as an identity provider, so for authentication purposes, you need to have an OAuth App registration for CodePush.
Client id and client secret created during registration should be provided to the CodePush server in environment variables.
Below are instructions on how to create OAuth App registrations.

### GitHub

1. Go to <https://github.com/settings/developers>
2. Click on `New OAuth App`
3. `Homepage URL` parameter will be the same as URL of your CodePush application (for local development it will be either <http://localhost:3000> or <https://localhost:8443>)
4. `Authorization callback URL` will be `/auth/callback/github` (for local development it will be either <http://localhost:3000/auth/callback/github> or <https://localhost:8443/auth/callback/github>)

## Metrics

Installation metrics allow monitoring release activity via the CLI. For detailed usage instructions, please refer to the [CLI documentation](../cli/README.md#development-parameter).

Redis is required for Metrics to work.

### Steps

1. Install Redis by following [official installation guide](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/).
1. TLS is required. Follow [official Redis TLS run guide](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/#running-manually).
1. Set the necessary environment variables for [Redis](./ENVIRONMENT.md#redis).
