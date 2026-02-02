#!/usr/bin/env node

import { Command } from 'commander';
import { scanCommand } from './commands/scan';
import { fixCommand } from './commands/fix';
import { checkCommand } from './commands/check';
import { installHookCommand, uninstallHookCommand } from './commands/install-hook';
import { Logger } from './utils/logger';
import { version } from '../package.json';

const program = new Command();

program
  .name('envguard')
  .description('Keep your environment variables in sync with your codebase')
  .version(version);

program
  .command('scan')
  .description('Scan codebase and compare with .env files')
  .option('--ci', 'Exit with error code if issues found (for CI/CD)')
  .option('--strict', 'Report all variables including known runtime variables (AWS_REGION, NODE_ENV, etc.)')
  .option('--no-detect-fallbacks', 'Treat all missing variables as errors, ignoring fallback detection')
  .action(async (cmd, command) => {
    try {
      // Build options object, only including detectFallbacks if the flag was used
      const options: any = {
        ci: cmd.ci,
        strict: cmd.strict
      };

      // Check if the --no-detect-fallbacks flag was explicitly provided
      // Commander adds it to the command's options when the flag is used
      const flagProvided = command.parent?.rawArgs.some((arg: string) => arg.includes('detect-fallback'));
      if (flagProvided) {
        options.detectFallbacks = cmd.detectFallbacks;
      }

      await scanCommand(options);
    } catch (error) {
      Logger.error(`${error}`);
      process.exit(1);
    }
  });

program
  .command('fix')
  .description('Auto-generate .env.example from codebase')
  .action(async () => {
    try {
      await fixCommand();
    } catch (error) {
      Logger.error(`${error}`);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Check for issues (alias for scan --ci)')
  .option('--strict', 'Report all variables including known runtime variables (AWS_REGION, NODE_ENV, etc.)')
  .option('--no-detect-fallbacks', 'Treat all missing variables as errors, ignoring fallback detection')
  .action(async (cmd, command) => {
    try {
      const options: any = {
        ci: true,
        strict: cmd.strict
      };

      // Check if the --no-detect-fallbacks flag was explicitly provided
      const flagProvided = command.parent?.rawArgs.some((arg: string) => arg.includes('detect-fallback'));
      if (flagProvided) {
        options.detectFallbacks = cmd.detectFallbacks;
      }

      await scanCommand(options);
    } catch (error) {
      Logger.error(`${error}`);
      process.exit(1);
    }
  });

program
  .command('install-hook')
  .description('Install a Git hook to run envguard automatically')
  .option('--type <type>', 'Hook type: pre-commit or pre-push (default: pre-commit)')
  .option('--force', 'Overwrite existing hook if present')
  .action(async (cmd) => {
    try {
      await installHookCommand({
        type: cmd.type,
        force: cmd.force
      });
    } catch (error) {
      Logger.error(`${error}`);
      process.exit(1);
    }
  });

program
  .command('uninstall-hook')
  .description('Remove the envguard Git hook')
  .option('--type <type>', 'Hook type: pre-commit or pre-push (default: pre-commit)')
  .action(async (cmd) => {
    try {
      await uninstallHookCommand({
        type: cmd.type
      });
    } catch (error) {
      Logger.error(`${error}`);
      process.exit(1);
    }
  });

program.parse();
