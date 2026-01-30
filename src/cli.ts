#!/usr/bin/env node

import { Command } from 'commander';
import { scanCommand } from './commands/scan';
import { fixCommand } from './commands/fix';
import { checkCommand } from './commands/check';
import { Logger } from './utils/logger';

const program = new Command();

program
  .name('envguard')
  .description('Keep your environment variables in sync with your codebase')
  .version('0.1.0');

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

program.parse();
