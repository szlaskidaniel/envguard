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

export async function scanCommand(options: { ci?: boolean; strict?: boolean; detectFallbacks?: boolean }) {
  const rootDir = process.cwd();

  // Load configuration
  const config = ConfigLoader.loadConfig(rootDir);

  // CLI options override config file
  const strictMode = options.strict !== undefined ? options.strict : config.strict;
  const detectFallbacks = options.detectFallbacks !== undefined ? options.detectFallbacks : (config.detectFallbacks !== undefined ? config.detectFallbacks : true);

  Logger.startSpinner('Scanning codebase for environment variables...');

  // Step 1: Find all .env files and serverless.yml files
  const excludePatterns = [
    'node_modules',
    'dist',
    'build',
    '.git',
    ...(config.exclude || []),
  ];
  const scanner = new CodeScanner(rootDir, excludePatterns);
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
    const usedVars = await scanDirectoryForCodeVars(rootDir, serverlessDir, scanner, config.exclude);
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
    const missingFromServerless: Array<{ varName: string; locations: string[]; hasFallback: boolean; category?: string }> = [];
    const skippedRuntimeVars: Array<{ varName: string; category: string }> = [];

    for (const [varName, usage] of usedVars.entries()) {
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
          missingFromServerless.push({ varName, locations: usage.locations, hasFallback: usage.hasFallback });
        }
      }
    }

    if (unusedServerlessVars.length > 0) {
      Logger.info('Unused variables in serverless.yml:', true);
      unusedServerlessVars.forEach((varName) => {
        Logger.infoItem(varName, 2);
        allIssues.push({
          type: 'unused',
          severity: 'info',
          varName,
          details: `Defined in serverless.yml but never used in code`,
        });
      });
      Logger.blank();
    }

    if (missingFromServerless.length > 0) {
      // Group by severity (respect detectFallbacks config)
      const errors = missingFromServerless.filter(item => !detectFallbacks || !item.hasFallback);
      const warnings = missingFromServerless.filter(item => detectFallbacks && item.hasFallback);

      if (errors.length > 0) {
        Logger.error('Missing from serverless.yml:', true);
        errors.forEach((item) => {
          Logger.errorItem(item.varName, 2);
          if (item.locations && item.locations.length > 0) {
            Logger.info(`Used in: ${item.locations.slice(0, 2).join(', ')}`, true);
          }
          const details = (detectFallbacks && item.hasFallback)
            ? `Used in code with fallback but not defined in serverless.yml`
            : `Used in code but not defined in serverless.yml`;
          allIssues.push({
            type: 'missing',
            severity: 'error',
            varName: item.varName,
            details,
            locations: item.locations,
          });
        });
        Logger.blank();
      }

      if (warnings.length > 0) {
        Logger.warning('Missing from serverless.yml (with fallback):', true);
        warnings.forEach((item) => {
          Logger.warningItem(item.varName, 2);
          if (item.locations && item.locations.length > 0) {
            Logger.info(`Used in: ${item.locations.slice(0, 2).join(', ')}`, true);
          }
          allIssues.push({
            type: 'missing',
            severity: 'warning',
            varName: item.varName,
            details: `Used in code with fallback but not defined in serverless.yml`,
            locations: item.locations,
          });
        });
        Logger.blank();
      }
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
    const allUsedVars = await scanDirectoryForVars(rootDir, envDir, scanner, config.exclude);

    // Filter out ignored variables based on config
    const usedVars = new Map<string, { locations: string[], hasFallback: boolean }>();
    const skippedVarsInScope: Array<{ varName: string; category: string }> = [];

    for (const [varName, usage] of allUsedVars.entries()) {
      const isCustomIgnored = ConfigLoader.shouldIgnoreVar(varName, config);
      const isRuntimeVar = isKnownRuntimeVar(varName);

      // In non-strict mode, skip known runtime variables and custom ignore vars
      if (strictMode || (!isRuntimeVar && !isCustomIgnored)) {
        usedVars.set(varName, usage);
      } else {
        const category = isCustomIgnored ? 'Custom (from config)' : getRuntimeVarCategory(varName);
        if (category) {
          skippedVarsInScope.push({ varName, category });
        }
      }
    }

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
    const result = analyzer.analyze(usedVars, definedVars, exampleVars, detectFallbacks);

    if (result.issues.length > 0) {
      // Group issues by type and severity
      const missingErrors = result.issues.filter(i => i.type === 'missing' && i.severity === 'error');
      const missingWarnings = result.issues.filter(i => i.type === 'missing' && i.severity === 'warning');
      const unusedIssues = result.issues.filter(i => i.type === 'unused');
      const undocumentedWarnings = result.issues.filter(i => i.type === 'undocumented' && i.severity === 'warning');
      const undocumentedInfo = result.issues.filter(i => i.type === 'undocumented' && i.severity === 'info');

      if (missingErrors.length > 0) {
        Logger.error('Missing from .env:', true);
        missingErrors.forEach((issue) => {
          Logger.errorItem(issue.varName, 2);
          if (issue.locations && issue.locations.length > 0) {
            Logger.info(`Used in: ${issue.locations.slice(0, 2).join(', ')}`, true);
          }
        });
        Logger.blank();
      }

      if (missingWarnings.length > 0) {
        Logger.warning('Missing from .env (with fallback):', true);
        missingWarnings.forEach((issue) => {
          Logger.warningItem(issue.varName, 2);
          if (issue.locations && issue.locations.length > 0) {
            Logger.info(`Used in: ${issue.locations.slice(0, 2).join(', ')}`, true);
          }
        });
        Logger.blank();
      }

      if (unusedIssues.length > 0) {
        Logger.info('Unused variables:', true);
        unusedIssues.forEach((issue) => {
          Logger.infoItem(issue.varName, 2);
        });
        Logger.blank();
      }

      if (undocumentedWarnings.length > 0) {
        Logger.warning('Missing from .env.example:', true);
        undocumentedWarnings.forEach((issue) => {
          Logger.warningItem(issue.varName, 2);
        });
        Logger.blank();
      }

      if (undocumentedInfo.length > 0) {
        Logger.info('Missing from .env.example (with fallback):', true);
        undocumentedInfo.forEach((issue) => {
          Logger.infoItem(issue.varName, 2);
        });
        Logger.blank();
      }

      allIssues.push(...result.issues);
    } else {
      Logger.success('No issues in this directory', true);
      Logger.blank();
    }

    // Show skipped variables in non-strict mode
    if (!strictMode && skippedVarsInScope.length > 0) {
      Logger.info('Skipped known runtime/ignored variables (use --strict to show):', true);
      // Group by category
      const grouped = new Map<string, string[]>();
      for (const { varName, category } of skippedVarsInScope) {
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

  // Display summary
  Logger.divider();
  if (allIssues.length === 0) {
    Logger.summary('No issues found! All environment variables are in sync.');
    return { success: true, issues: [] };
  }

  // Count issues by severity
  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;
  const infoCount = allIssues.filter(i => i.severity === 'info').length;

  Logger.blank();
  if (errorCount > 0) {
    Logger.error(`Errors: ${errorCount}`, false);
  }
  if (warningCount > 0) {
    Logger.warning(`Warnings: ${warningCount}`, false);
  }
  if (infoCount > 0) {
    Logger.info(`Info: ${infoCount}`, false);
  }
  Logger.blank();
  Logger.warning(`Total: ${allIssues.length} issue(s) across ${envFiles.length + serverlessFiles.length} location(s)`);
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
  scanner: CodeScanner,
  excludePatterns: string[] = []
): Promise<Map<string, { locations: string[], hasFallback: boolean }>> {
  const envVars = new Map<string, { locations: string[], hasFallback: boolean }>();

  // Find all code files in this directory and subdirectories
  const relativeDir = path.relative(rootDir, targetDir);
  const pattern = relativeDir ? `${relativeDir}/**/*.{js,ts,jsx,tsx,mjs,cjs}` : '**/*.{js,ts,jsx,tsx,mjs,cjs}';

  const defaultIgnore = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
  const customIgnore = excludePatterns.map(p => p.includes('*') ? p : `**/${p}/**`);

  const files = await glob(pattern, {
    cwd: rootDir,
    ignore: [...defaultIgnore, ...customIgnore],
    absolute: true,
  });

  for (const file of files) {
    const vars = await scanner.scanFile(file);
    for (const [varName, hasFallback] of vars.entries()) {
      const relativePath = path.relative(rootDir, file);
      if (!envVars.has(varName)) {
        envVars.set(varName, { locations: [], hasFallback: false });
      }
      const entry = envVars.get(varName)!;
      entry.locations.push(relativePath);
      entry.hasFallback = entry.hasFallback || hasFallback;
    }
  }

  return envVars;
}

// Scan only code files (JS/TS), not including serverless.yml as a source
async function scanDirectoryForCodeVars(
  rootDir: string,
  targetDir: string,
  scanner: CodeScanner,
  excludePatterns: string[] = []
): Promise<Map<string, { locations: string[], hasFallback: boolean }>> {
  const envVars = new Map<string, { locations: string[], hasFallback: boolean }>();

  // Find all code files in this directory only (not subdirectories for serverless)
  const relativeDir = path.relative(rootDir, targetDir);
  const pattern = relativeDir ? `${relativeDir}/**/*.{js,ts,jsx,tsx,mjs,cjs}` : '**/*.{js,ts,jsx,tsx,mjs,cjs}';

  const defaultIgnore = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
  const customIgnore = excludePatterns.map(p => p.includes('*') ? p : `**/${p}/**`);

  const files = await glob(pattern, {
    cwd: rootDir,
    ignore: [...defaultIgnore, ...customIgnore],
    absolute: true,
  });

  for (const file of files) {
    const vars = await scanner.scanFile(file);
    for (const [varName, hasFallback] of vars.entries()) {
      const relativePath = path.relative(rootDir, file);
      if (!envVars.has(varName)) {
        envVars.set(varName, { locations: [], hasFallback: false });
      }
      const entry = envVars.get(varName)!;
      entry.locations.push(relativePath);
      entry.hasFallback = entry.hasFallback || hasFallback;
    }
  }

  return envVars;
}
