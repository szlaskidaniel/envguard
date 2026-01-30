import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { CodeScanner } from '../scanner/codeScanner';
import { EnvParser, EnvEntry } from '../parser/envParser';
import { ServerlessParser } from '../parser/serverlessParser';
import { EnvAnalyzer } from '../analyzer/envAnalyzer';
import { Issue } from '../types';
import { isKnownRuntimeVar, getRuntimeVarCategory } from '../constants/knownEnvVars';
import { ConfigLoader } from '../config/configLoader';
import { Logger } from '../utils/logger';

export async function scanCommand(options: { ci?: boolean; strict?: boolean }) {
  const rootDir = process.cwd();

  // Load configuration
  const config = ConfigLoader.loadConfig(rootDir);

  // CLI options override config file
  const strictMode = options.strict !== undefined ? options.strict : config.strict;

  Logger.startSpinner('Scanning codebase for environment variables...');

  // Step 1: Find all .env files and serverless.yml files
  const scanner = new CodeScanner(rootDir);
  const envFiles = await scanner.findEnvFiles();
  const serverlessFiles = await scanner.findServerlessFiles();

  Logger.stopSpinner();

  if (envFiles.length === 0 && serverlessFiles.length === 0) {
    Logger.warning('No .env or serverless.yml files found in the project');
    Logger.blank();
    return { success: false, issues: [] };
  }

  Logger.success(`Found ${envFiles.length} .env file(s) and ${serverlessFiles.length} serverless.yml file(s)`);
  Logger.blank();

  const parser = new EnvParser();
  const serverlessParser = new ServerlessParser();
  const analyzer = new EnvAnalyzer();
  const allIssues: Issue[] = [];

  // Step 2a: Process serverless.yml files independently
  for (const serverlessFilePath of serverlessFiles) {
    const serverlessDir = path.dirname(serverlessFilePath);
    const relativePath = path.relative(rootDir, serverlessFilePath);

    Logger.path(`Checking ${relativePath}`);
    Logger.blank();

    // Parse serverless.yml
    const serverlessVars = serverlessParser.parse(serverlessFilePath);
    Logger.info(`Found ${serverlessVars.size} variable(s) in serverless.yml`, true);

    // Scan code files in this directory to see what's actually used
    const usedVars = await scanDirectoryForCodeVars(rootDir, serverlessDir, scanner);
    Logger.info(`Found ${usedVars.size} variable(s) used in code`, true);
    Logger.blank();

    // Check for unused variables in serverless.yml
    const unusedServerlessVars: string[] = [];
    for (const [varName] of serverlessVars.entries()) {
      if (!usedVars.has(varName)) {
        // In non-strict mode, skip known runtime variables and custom ignore vars from "unused" warnings
        const isIgnored = isKnownRuntimeVar(varName) || ConfigLoader.shouldIgnoreVar(varName, config);
        if (strictMode || !isIgnored) {
          unusedServerlessVars.push(varName);
        }
      }
    }

    // Check for variables used in code but not defined in serverless.yml
    const missingFromServerless: Array<{ varName: string; locations: string[]; category?: string }> = [];
    const skippedRuntimeVars: Array<{ varName: string; category: string }> = [];

    for (const [varName, locations] of usedVars.entries()) {
      if (!serverlessVars.has(varName)) {
        // In non-strict mode, skip known runtime variables and custom ignore vars
        const isCustomIgnored = ConfigLoader.shouldIgnoreVar(varName, config);
        const isRuntimeVar = isKnownRuntimeVar(varName);

        if (!strictMode && (isRuntimeVar || isCustomIgnored)) {
          const category = isCustomIgnored ? 'Custom (from config)' : getRuntimeVarCategory(varName);
          if (category) {
            skippedRuntimeVars.push({ varName, category });
          }
        } else {
          missingFromServerless.push({ varName, locations });
        }
      }
    }

    if (unusedServerlessVars.length > 0) {
      Logger.warning('Unused variables in serverless.yml:', true);
      unusedServerlessVars.forEach((varName) => {
        Logger.warningItem(varName, 2);
        allIssues.push({
          type: 'unused',
          varName,
          details: `Defined in serverless.yml but never used in code`,
        });
      });
      Logger.blank();
    }

    if (missingFromServerless.length > 0) {
      Logger.error('Missing from serverless.yml:', true);
      missingFromServerless.forEach((item) => {
        Logger.errorItem(item.varName, 2);
        if (item.locations && item.locations.length > 0) {
          Logger.info(`Used in: ${item.locations.slice(0, 2).join(', ')}`, true);
        }
        allIssues.push({
          type: 'missing',
          varName: item.varName,
          details: `Used in code but not defined in serverless.yml`,
          locations: item.locations,
        });
      });
      Logger.blank();
    }

    if (unusedServerlessVars.length === 0 && missingFromServerless.length === 0) {
      Logger.success('No issues in this serverless.yml', true);
      Logger.blank();
    }

    // Show skipped runtime variables in non-strict mode
    if (!strictMode && skippedRuntimeVars.length > 0) {
      Logger.info('Skipped known runtime variables (use --strict to show):', true);
      // Group by category
      const grouped = new Map<string, string[]>();
      for (const { varName, category } of skippedRuntimeVars) {
        if (!grouped.has(category)) {
          grouped.set(category, []);
        }
        grouped.get(category)!.push(varName);
      }
      for (const [category, vars] of grouped.entries()) {
        Logger.info(`${category}: ${vars.join(', ')}`, true);
      }
      Logger.blank();
    }
  }

  // Step 2b: Process each .env file (including directories that also have serverless.yml)
  for (const envFilePath of envFiles) {
    const envDir = path.dirname(envFilePath);
    const relativePath = path.relative(rootDir, envDir);
    const displayPath = relativePath || '.';

    Logger.path(`Checking ${displayPath}/`);
    Logger.blank();

    // Step 3: Scan code files in this directory and subdirectories
    const usedVars = await scanDirectoryForVars(rootDir, envDir, scanner);

    Logger.info(`Found ${usedVars.size} variable(s) used in this scope`, true);

    // Step 4: Parse .env file
    const definedVars = parser.parse(envFilePath);
    Logger.info(`Found ${definedVars.size} variable(s) in .env`, true);

    // Step 5: Parse .env.example
    const examplePath = path.join(envDir, '.env.example');
    const exampleVars = parser.parseExample(examplePath);
    Logger.info(`Found ${exampleVars.size} variable(s) in .env.example`, true);
    Logger.blank();

    // Step 6: Analyze and find issues
    const result = analyzer.analyze(usedVars, definedVars, exampleVars);

    if (result.issues.length > 0) {
      // Group issues by type
      const missingIssues = result.issues.filter(i => i.type === 'missing');
      const unusedIssues = result.issues.filter(i => i.type === 'unused');
      const undocumentedIssues = result.issues.filter(i => i.type === 'undocumented');

      if (missingIssues.length > 0) {
        Logger.error('Missing from .env:', true);
        missingIssues.forEach((issue) => {
          Logger.errorItem(issue.varName, 2);
          if (issue.locations && issue.locations.length > 0) {
            Logger.info(`Used in: ${issue.locations.slice(0, 2).join(', ')}`, true);
          }
        });
        Logger.blank();
      }

      if (unusedIssues.length > 0) {
        Logger.warning('Unused variables:', true);
        unusedIssues.forEach((issue) => {
          Logger.warningItem(issue.varName, 2);
        });
        Logger.blank();
      }

      if (undocumentedIssues.length > 0) {
        Logger.info('Missing from .env.example:', true);
        undocumentedIssues.forEach((issue) => {
          Logger.infoItem(issue.varName, 2);
        });
        Logger.blank();
      }

      allIssues.push(...result.issues);
    } else {
      Logger.success('No issues in this directory', true);
      Logger.blank();
    }
  }

  // Display summary
  Logger.divider();
  if (allIssues.length === 0) {
    Logger.summary('No issues found! All environment variables are in sync.');
    return { success: true, issues: [] };
  }

  Logger.blank();
  Logger.warning(`Total: ${allIssues.length} issue(s) across ${envFiles.length} location(s)`);
  Logger.blank();

  // Suggest fix
  if (!options.ci) {
    Logger.info('Run `envguard fix` to auto-generate .env.example files');
    Logger.blank();
  }

  // Exit with error code in CI mode
  if (options.ci) {
    Logger.error('Issues found. Exiting with error code 1.');
    Logger.blank();
    process.exit(1);
  }

  return { success: false, issues: allIssues };
}

async function scanDirectoryForVars(
  rootDir: string,
  targetDir: string,
  scanner: CodeScanner
): Promise<Map<string, string[]>> {
  const envVars = new Map<string, string[]>();

  // Find all code files in this directory and subdirectories
  const relativeDir = path.relative(rootDir, targetDir);
  const pattern = relativeDir ? `${relativeDir}/**/*.{js,ts,jsx,tsx,mjs,cjs}` : '**/*.{js,ts,jsx,tsx,mjs,cjs}';

  const files = await glob(pattern, {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    absolute: true,
  });

  for (const file of files) {
    const vars = await scanner.scanFile(file);
    for (const varName of vars) {
      const relativePath = path.relative(rootDir, file);
      if (!envVars.has(varName)) {
        envVars.set(varName, []);
      }
      envVars.get(varName)!.push(relativePath);
    }
  }

  return envVars;
}

// Scan only code files (JS/TS), not including serverless.yml as a source
async function scanDirectoryForCodeVars(
  rootDir: string,
  targetDir: string,
  scanner: CodeScanner
): Promise<Map<string, string[]>> {
  const envVars = new Map<string, string[]>();

  // Find all code files in this directory only (not subdirectories for serverless)
  const relativeDir = path.relative(rootDir, targetDir);
  const pattern = relativeDir ? `${relativeDir}/**/*.{js,ts,jsx,tsx,mjs,cjs}` : '**/*.{js,ts,jsx,tsx,mjs,cjs}';

  const files = await glob(pattern, {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    absolute: true,
  });

  for (const file of files) {
    const vars = await scanner.scanFile(file);
    for (const varName of vars) {
      const relativePath = path.relative(rootDir, file);
      if (!envVars.has(varName)) {
        envVars.set(varName, []);
      }
      envVars.get(varName)!.push(relativePath);
    }
  }

  return envVars;
}
