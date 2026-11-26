// Mac builds: give the app an ad-hoc signature (no Apple Developer ID needed).
// Without any signature, macOS on Apple Silicon says a downloaded app "is damaged and
// can't be opened". With an ad-hoc one it's treated as from an unidentified developer,
// which you can allow once in System Settings > Privacy & Security.
// Runs after packaging, before the .dmg and .zip are made (electron-builder afterPack;
// afterSign is skipped when there's no Developer ID).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
