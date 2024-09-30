# Visual Studio App Center CodePush Standalone Version

[CodePush](https://learn.microsoft.com/en-us/appcenter/distribution/codepush/) is an App Center feature that enables React Native developers to deploy mobile app updates directly to their users’ devices. It consists of two parts: CodePush Server where developers can publish app updates to (e.g. JS, HTML, CSS or image changes), and [CodePush React Native Client SDK](https://github.com/Microsoft/react-native-code-push) that enables querying for updates from within an app.

We announced that Visual Studio App Center will be retired on March 31, 2025. You can learn more about the support timeline and alternatives on https://aka.ms/appcenter/retire. In order to let developers keep using CodePush functionality after App Center is fully retired, we created a standalone version of CodePush Server that can be deployed and used independently from App Center itself. Code of this standalone version can be found in this repository. It is fully compatible with [CodePush React Native Client SDK](https://github.com/Microsoft/react-native-code-push).


## Getting Started

### CodePush Server

The CodePush server, located in the `api` subdirectory, allows developers to build, deploy and manage CodePush updates themselves.
For detailed information about the CodePush server, including installation instructions and usage details, please refer to the [CodePush Server README](./api/README.md).


### CodePush CLI

The CodePush CLI, located in `cli` subdirectory, is a command-line tool that allows developers to interact with the CodePush server. For detailed information about the CodePush CLI, including installation instructions and usage details, please refer to the [CodePush CLI README](./cli/README.md).


## Contributing

While we cannot accept contributions or issues in this repository; however, as a permissively licensed open-source project, it is ready for community development and forks independently.


## Support

This code is provided “as is”, because of that Microsoft will not provide support services for it.


## Legal Notice

Microsoft grants you access to the code in this repository under the MIT License, see the [LICENSE](./LICENSE) to learn more.

Microsoft, Windows, Microsoft Azure and/or other Microsoft products and services referenced in the documentation may be either trademarks or registered trademarks of Microsoft in the United States and/or other countries. The license for this code does not grant you rights to use any Microsoft names, logos, or trademarks. Go to [Microsoft Trademark and Brand Guidelines](http://go.microsoft.com/fwlink/?LinkID=254653) for more information.

Privacy information can be found at https://privacy.microsoft.com/.
