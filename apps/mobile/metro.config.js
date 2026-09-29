/**
 * Metro config for the pnpm monorepo. Expo's default config already detects the workspace root
 * (watchFolders + nodeModulesPaths). Two additions:
 *  1. Workspace packages (@city/core, @city/client) are TypeScript sources that use NodeNext-style
 *     `./x.js` specifiers pointing at `./x.ts`; rewrite those for files inside /packages.
 *  2. Nothing else: no custom transformer, no asset plugins.
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const packagesDir = path.resolve(__dirname, '..', '..', 'packages') + path.sep;

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.startsWith(packagesDir)) {
    try {
      return resolve(context, moduleName.slice(0, -3) + '.ts', platform);
    } catch {
      /* fall through to the original specifier */
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
