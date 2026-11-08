const path = require('path');
const fs = require('fs');
const { tests } = require('@iobroker/testing');

const executeCommandModule = require('@iobroker/testing/build/lib/executeCommand');
const executeCommand = executeCommandModule.executeCommand;
const adapterPackage = require('../package.json');

// The integration helper currently ignores errors from the initial controller install.
executeCommandModule.executeCommand = async (command, argsOrOptions, options) => {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    const cwd = options && options.cwd;
    const testPackagePath = cwd && path.join(cwd, 'package.json');
    const testPackage =
        testPackagePath && fs.existsSync(testPackagePath)
            ? JSON.parse(fs.readFileSync(testPackagePath, 'utf8'))
            : undefined;
    const controllerDependency =
        testPackage &&
        Object.keys(testPackage.dependencies || {}).find(dependency => dependency.endsWith('.js-controller'));
    const appName = controllerDependency && controllerDependency.slice(0, -'.js-controller'.length);
    const configPath = appName && path.join(cwd, `${appName}-data`, `${appName}.json`);
    const initialControllerInstall =
        command === 'npm' &&
        args[0] === 'i' &&
        args.includes('--omit=dev') &&
        testPackage &&
        !testPackage.dependencies[adapterPackage.name] &&
        configPath &&
        !fs.existsSync(configPath);

    const result = await executeCommand(command, argsOrOptions, options);
    if (!initialControllerInstall) {
        return result;
    }

    if (result.error || result.exitCode !== 0) {
        const status = result.error
            ? `could not be started: ${result.error.message}`
            : `exited with code ${result.exitCode}`;
        throw new Error(
            `Installing the JS-Controller failed (${status}).\n${result.stderr || 'No stderr output was captured.'}`,
        );
    }

    if (!fs.existsSync(configPath)) {
        const dataDir = path.dirname(configPath);
        const contents = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).join(', ') || '(empty)' : '(missing)';
        throw new Error(
            `The JS-Controller install completed successfully but did not create ${configPath}. ` +
                `Data directory contents: ${contents}`,
        );
    }

    return result;
};

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'));
