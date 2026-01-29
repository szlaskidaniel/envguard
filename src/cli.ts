#!/usr/bin/env node

import { Command } from 'commander';
import { scanCommand } from './commands/scan';
import { fixCommand } from './commands/fix';
import { checkCommand } from './commands/check';

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
  .action(async (options) => {
    try {
      await scanCommand(options);
    } catch (error) {
      console.error('Error:', error);
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
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Check for issues (alias for scan --ci)')
  .option('--strict', 'Report all variables including known runtime variables (AWS_REGION, NODE_ENV, etc.)')
  .action(async (options) => {
    try {
      await scanCommand({ ci: true, strict: options.strict });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program.parse();
