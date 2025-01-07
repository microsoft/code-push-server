import * as fs from "fs";
import * as chalk from "chalk";
import * as path from "path";
import * as childProcess from "child_process";
import { coerce, compare, valid } from "semver";
import { fileDoesNotExistOrIsDirectory } from "./utils/file-utils";

const g2js = require("gradle-to-js/lib/parser");

export function isValidVersion(version: string): boolean {
  return !!valid(version) || /^\d+\.\d+$/.test(version);
}

export async function runHermesEmitBinaryCommand(
    bundleName: string,
    outputFolder: string,
    sourcemapOutput: string,
    extraHermesFlags: string[],
    gradleFile: string
): Promise<void> {
  const hermesArgs: string[] = [];
  const envNodeArgs: string = process.env.CODE_PUSH_NODE_ARGS;

  if (typeof envNodeArgs !== "undefined") {
    Array.prototype.push.apply(hermesArgs, envNodeArgs.trim().split(/\s+/));
  }

  Array.prototype.push.apply(hermesArgs, [
    "-emit-binary",
    "-out",
    path.join(outputFolder, bundleName + ".hbc"),
    path.join(outputFolder, bundleName),
    ...extraHermesFlags,
  ]);

  if (sourcemapOutput) {
    hermesArgs.push("-output-source-map");
  }

  console.log(chalk.cyan("Converting JS bundle to byte code via Hermes, running command:\n"));
  const hermesCommand = await getHermesCommand(gradleFile);
  const hermesProcess = childProcess.spawn(hermesCommand, hermesArgs);
  console.log(`${hermesCommand} ${hermesArgs.join(" ")}`);

  return new Promise<void>((resolve, reject) => {
    hermesProcess.stdout.on("data", (data: Buffer) => {
      console.log(data.toString().trim());
    });

    hermesProcess.stderr.on("data", (data: Buffer) => {
      console.error(data.toString().trim());
    });

    hermesProcess.on("close", (exitCode: number, signal: string) => {
      if (exitCode !== 0) {
        reject(new Error(`"hermes" command failed (exitCode=${exitCode}, signal=${signal}).`));
      }
      // Copy HBC bundle to overwrite JS bundle
      const source = path.join(outputFolder, bundleName + ".hbc");
      const destination = path.join(outputFolder, bundleName);
      fs.copyFile(source, destination, (err) => {
        if (err) {
          console.error(err);
          reject(new Error(`Copying file ${source} to ${destination} failed. "hermes" previously exited with code ${exitCode}.`));
        }
        fs.unlink(source, (err) => {
          if (err) {
            console.error(err);
            reject(err);
          }
          resolve(null as void);
        });
      });
    });
  }).then(() => {
    if (!sourcemapOutput) {
      // skip source map compose if source map is not enabled
      return;
    }

    const composeSourceMapsPath = getComposeSourceMapsPath();
    if (!composeSourceMapsPath) {
      throw new Error("react-native compose-source-maps.js scripts is not found");
    }

    const jsCompilerSourceMapFile = path.join(outputFolder, bundleName + ".hbc" + ".map");
    if (!fs.existsSync(jsCompilerSourceMapFile)) {
      throw new Error(`sourcemap file ${jsCompilerSourceMapFile} is not found`);
    }

    return new Promise((resolve, reject) => {
      const composeSourceMapsArgs = [composeSourceMapsPath, sourcemapOutput, jsCompilerSourceMapFile, "-o", sourcemapOutput];

      // https://github.com/facebook/react-native/blob/master/react.gradle#L211
      // https://github.com/facebook/react-native/blob/master/scripts/react-native-xcode.sh#L178
      // packager.sourcemap.map + hbc.sourcemap.map = sourcemap.map
      const composeSourceMapsProcess = childProcess.spawn("node", composeSourceMapsArgs);
      console.log(`${composeSourceMapsPath} ${composeSourceMapsArgs.join(" ")}`);

      composeSourceMapsProcess.stdout.on("data", (data: Buffer) => {
        console.log(data.toString().trim());
      });

      composeSourceMapsProcess.stderr.on("data", (data: Buffer) => {
        console.error(data.toString().trim());
      });

      composeSourceMapsProcess.on("close", (exitCode: number, signal: string) => {
        if (exitCode !== 0) {
          reject(new Error(`"compose-source-maps" command failed (exitCode=${exitCode}, signal=${signal}).`));
        }

        // Delete the HBC sourceMap, otherwise it will be included in 'code-push' bundle as well
        fs.unlink(jsCompilerSourceMapFile, (err) => {
          if (err) {
            console.error(err);
            reject(err);
          }

          resolve(null);
        });
      });
    });
  });
}

function parseBuildGradleFile(gradleFile: string) {
  let buildGradlePath: string = path.join("android", "app");
  if (gradleFile) {
    buildGradlePath = gradleFile;
  }
  if (fs.lstatSync(buildGradlePath).isDirectory()) {
    buildGradlePath = path.join(buildGradlePath, "build.gradle");
  }

  if (fileDoesNotExistOrIsDirectory(buildGradlePath)) {
    throw new Error(`Unable to find gradle file "${buildGradlePath}".`);
  }

  return g2js.parseFile(buildGradlePath).catch(() => {
    throw new Error(`Unable to parse the "${buildGradlePath}" file. Please ensure it is a well-formed Gradle file.`);
  });
}

async function getHermesCommandFromGradle(gradleFile: string): Promise<string> {
  const buildGradle: any = await parseBuildGradleFile(gradleFile);
  const hermesCommandProperty: any = Array.from(buildGradle["project.ext.react"] || []).find((prop: string) =>
    prop.trim().startsWith("hermesCommand:")
  );
  if (hermesCommandProperty) {
    return hermesCommandProperty.replace("hermesCommand:", "").trim().slice(1, -1);
  } else {
    return "";
  }
}

export function getAndroidHermesEnabled(gradleFile: string): boolean {
  return parseBuildGradleFile(gradleFile).then((buildGradle: any) => {
    return Array.from(buildGradle["project.ext.react"] || []).some((line: string) => /^enableHermes\s{0,}:\s{0,}true/.test(line));
  });
}

export function getiOSHermesEnabled(podFile: string): boolean {
  let podPath = path.join("ios", "Podfile");
  if (podFile) {
    podPath = podFile;
  }
  if (fileDoesNotExistOrIsDirectory(podPath)) {
    throw new Error(`Unable to find Podfile file "${podPath}".`);
  }

  try {
    const podFileContents = fs.readFileSync(podPath).toString();
    return /([^#\n]*:?hermes_enabled(\s+|\n+)?(=>|:)(\s+|\n+)?true)/.test(podFileContents);
  } catch (error) {
    throw error;
  }
}

function getHermesOSBin(): string {
  switch (process.platform) {
    case "win32":
      return "win64-bin";
    case "darwin":
      return "osx-bin";
    case "freebsd":
    case "linux":
    case "sunos":
    default:
      return "linux64-bin";
  }
}

function getHermesOSExe(): string {
  const react63orAbove = compare(coerce(getReactNativeVersion()).version, "0.63.0") !== -1;
  const hermesExecutableName = react63orAbove ? "hermesc" : "hermes";
  switch (process.platform) {
    case "win32":
      return hermesExecutableName + ".exe";
    default:
      return hermesExecutableName;
  }
}

async function getHermesCommand(gradleFile: string): Promise<string> {
  const fileExists = (file: string): boolean => {
    try {
      return fs.statSync(file).isFile();
    } catch (e) {
      return false;
    }
  };
  // Hermes is bundled with react-native since 0.69
  const bundledHermesEngine = path.join(getReactNativePackagePath(), "sdks", "hermesc", getHermesOSBin(), getHermesOSExe());
  if (fileExists(bundledHermesEngine)) {
    return bundledHermesEngine;
  }

  const gradleHermesCommand = await getHermesCommandFromGradle(gradleFile);
  if (gradleHermesCommand) {
    return path.join("android", "app", gradleHermesCommand.replace("%OS-BIN%", getHermesOSBin()));
  } else {
    // assume if hermes-engine exists it should be used instead of hermesvm
    const hermesEngine = path.join("node_modules", "hermes-engine", getHermesOSBin(), getHermesOSExe());
    if (fileExists(hermesEngine)) {
      return hermesEngine;
    }
    return path.join("node_modules", "hermesvm", getHermesOSBin(), "hermes");
  }
}

function getComposeSourceMapsPath(): string {
  // detect if compose-source-maps.js script exists
  const composeSourceMaps = path.join(getReactNativePackagePath(), "scripts", "compose-source-maps.js");
  if (fs.existsSync(composeSourceMaps)) {
    return composeSourceMaps;
  }
  return null;
}

function getReactNativePackagePath(): string {
  const result = childProcess.spawnSync("node", ["--print", "require.resolve('react-native/package.json')"]);
  const packagePath = path.dirname(result.stdout.toString());
  if (result.status === 0 && directoryExistsSync(packagePath)) {
    return packagePath;
  }

  return path.join("node_modules", "react-native");
}

export function directoryExistsSync(dirname: string): boolean {
  try {
    return fs.statSync(dirname).isDirectory();
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
  return false;
}

export function getReactNativeVersion(): string {
  let packageJsonFilename;
  let projectPackageJson;
  try {
    packageJsonFilename = path.join(process.cwd(), "package.json");
    projectPackageJson = JSON.parse(fs.readFileSync(packageJsonFilename, "utf-8"));
  } catch (error) {
    throw new Error(
      `Unable to find or read "package.json" in the CWD. The "release-react" command must be executed in a React Native project folder.`
    );
  }

  const projectName: string = projectPackageJson.name;
  if (!projectName) {
    throw new Error(`The "package.json" file in the CWD does not have the "name" field set.`);
  }

  return (
    (projectPackageJson.dependencies && projectPackageJson.dependencies["react-native"]) ||
    (projectPackageJson.devDependencies && projectPackageJson.devDependencies["react-native"])
  );
}