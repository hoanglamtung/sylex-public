const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * watchFolders includes the client-rn root so that imports from ../src/**
 * (screens, hooks, services, i18n) are resolved correctly.
 * nodeModulesPaths falls back to client-rn/node_modules for any package not
 * yet installed in AssistantPro/node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    // Block stale client-rn/node_modules copies of react & react-native
    // packages (legacy 0.75.4 era). All RN imports must come from
    // AssistantPro/node_modules/ (0.84.1).
    blockList: [
      new RegExp(
        path.resolve(monorepoRoot, 'node_modules', 'react-native') +
          '(/.*|$)',
      ),
      new RegExp(
        path.resolve(monorepoRoot, 'node_modules', 'react') + '(/.*|$)',
      ),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
