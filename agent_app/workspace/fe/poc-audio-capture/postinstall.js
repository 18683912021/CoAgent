/**
 * postinstall.js
 * Fix: "Cannot read properties of undefined (reading 'handle')" in RN 0.77.x + @react-native-community/cli 20.x
 *
 * Root cause: @react-native-community/cli-server-api change broke the export of
 * `indexPageMiddleware`, causing it to be `undefined` when consumed by
 * @react-native-community/cli-plugin → metro → connect.use().
 *
 * Ref: https://github.com/react-native-community/cli/issues/2774
 *      https://github.com/facebook/metro/issues/1453
 */

const fs = require('fs');
const path = require('path');

const noopMiddleware = '((_req, _res, next) => next())';

// ── Patch 1: @react-native/community-cli-plugin ──────────────────────
const cliPluginFile = path.join(
  'node_modules',
  '@react-native-community',
  'cli-plugin',
  'dist',
  'commands',
  'start',
  'middleware.js'
);

if (fs.existsSync(cliPluginFile)) {
  let content = fs.readFileSync(cliPluginFile, 'utf8');

  // Replace undefined indexPageMiddleware with a noop fallback
  const pattern = /community\.indexPageMiddleware(?!\s*\?\?)/g;
  if (pattern.test(content)) {
    content = content.replace(
      /community\.indexPageMiddleware(?!\s*\?\?)/g,
      `(community.indexPageMiddleware ?? ${noopMiddleware})`
    );
    fs.writeFileSync(cliPluginFile, content);
    console.log('[postinstall] ✅ patched cli-plugin/middleware.js');
  } else {
    console.log('[postinstall] ⏭️  cli-plugin/middleware.js already patched or no match');
  }
} else {
  console.log('[postinstall] ⏭️  cli-plugin/middleware.js not found');
}

// ── Patch 2: metro/src/index.flow.js ──────────────────────────────────
const metroFile = path.join('node_modules', 'metro', 'src', 'index.flow.js');
const metroJsFile = path.join('node_modules', 'metro', 'src', 'index.js');
const targetMetroFile = fs.existsSync(metroFile) ? metroFile : metroJsFile;

if (fs.existsSync(targetMetroFile)) {
  let content = fs.readFileSync(targetMetroFile, 'utf8');

  // Guard: skip if already patched
  if (content.includes('// POSTINSTALL-PATCH')) {
    console.log('[postinstall] ⏭️  metro already patched');
  } else {
    // Wrap the line that calls .use() on the middleware array with a null-guard.
    // The pattern in metro is typically:
    //   middlewareManager.use(someVar);
    // where someVar may be undefined. We wrap it with:
    //   someVar && middlewareManager.use(someVar);
    const patched = content.replace(
      /( +)(middlewareManager\.use\((\w+)\))/g,
      '$1// POSTINSTALL-PATCH: guard against undefined middleware\n$1$3 && $2'
    );

    if (patched !== content) {
      fs.writeFileSync(targetMetroFile, patched);
      console.log('[postinstall] ✅ patched metro');
    } else {
      console.log('[postinstall] ⏭️  metro pattern not matched (may be pre-patched)');
    }
  }
} else {
  console.log('[postinstall] ⏭️  metro index not found');
}
