import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

const HOOK_TYPES = ['pre-commit', 'pre-push'] as const;
type HookType = typeof HOOK_TYPES[number];

interface InstallHookOptions {
  type?: HookType;
  force?: boolean;
}

/**
 * Install a Git hook that runs envguard before commits or pushes
 */
export async function installHookCommand(options: InstallHookOptions = {}) {
  const rootDir = process.cwd();
  const gitDir = path.join(rootDir, '.git');
  const hooksDir = path.join(gitDir, 'hooks');

  // Check if this is a git repository
  if (!fs.existsSync(gitDir)) {
    Logger.error('Not a git repository. Please run this command in a git repository.');
    Logger.blank();
    process.exit(1);
  }

  // Ensure hooks directory exists
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    Logger.success('Created .git/hooks directory');
  }

  const hookType = options.type || 'pre-commit';
  const hookPath = path.join(hooksDir, hookType);

  // Check if hook already exists
  if (fs.existsSync(hookPath) && !options.force) {
    Logger.warning(`${hookType} hook already exists.`);
    Logger.info('Use --force to overwrite the existing hook', true);
    Logger.blank();
    process.exit(1);
  }

  // Create the hook script
  const hookContent = generateHookScript(hookType);

  try {
    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
    Logger.success(`Installed ${hookType} hook successfully!`);
    Logger.blank();
    Logger.info('The hook will run `envguard scan --ci` automatically before each ' +
                (hookType === 'pre-commit' ? 'commit' : 'push'), true);
    Logger.info('To bypass the hook, use: git ' +
                (hookType === 'pre-commit' ? 'commit' : 'push') + ' --no-verify', true);
    Logger.blank();
  } catch (error) {
    Logger.error(`Failed to install hook: ${error}`);
    Logger.blank();
    process.exit(1);
  }
}

/**
 * Uninstall a Git hook
 */
export async function uninstallHookCommand(options: { type?: HookType } = {}) {
  const rootDir = process.cwd();
  const hookType = options.type || 'pre-commit';
  const hookPath = path.join(rootDir, '.git', 'hooks', hookType);

  if (!fs.existsSync(hookPath)) {
    Logger.warning(`No ${hookType} hook found.`);
    Logger.blank();
    return;
  }

  // Check if it's our hook
  const hookContent = fs.readFileSync(hookPath, 'utf-8');
  if (!hookContent.includes('envguard scan --ci') && !hookContent.includes('envguard check')) {
    Logger.warning(`The ${hookType} hook exists but was not created by envguard.`);
    Logger.info('Manual removal required if you want to delete it.', true);
    Logger.blank();
    return;
  }

  try {
    fs.unlinkSync(hookPath);
    Logger.success(`Removed ${hookType} hook successfully!`);
    Logger.blank();
  } catch (error) {
    Logger.error(`Failed to remove hook: ${error}`);
    Logger.blank();
    process.exit(1);
  }
}

/**
 * Generate the hook script content
 */
function generateHookScript(hookType: HookType): string {
  const hookMessage = hookType === 'pre-commit' ? 'commit' : 'push';

  return `#!/bin/sh
# EnvGuard ${hookType} hook
# This hook runs envguard to check environment variables before ${hookMessage}
# To bypass this hook, use: git ${hookMessage} --no-verify

echo "Running EnvGuard environment variable check..."

# Run envguard scan --ci
npx envguard scan --ci

# Capture the exit code
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ EnvGuard check failed. Please fix the issues above before ${hookMessage}ing."
  echo "   Or run: git ${hookMessage} --no-verify to bypass this check."
  echo ""
  exit 1
fi

echo "✓ EnvGuard check passed!"
exit 0
`;
}
