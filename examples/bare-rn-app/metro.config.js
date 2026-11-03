const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// This app lives in a pnpm workspace: let Metro watch the workspace root, where pnpm keeps the
// real package directories that node_modules symlinks point to.
const workspaceRoot = path.resolve(__dirname, '../..');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.join(__dirname, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
  },
});
