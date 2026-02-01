import * as path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { CodeScanner } from '../scanner/codeScanner';
import { EnvParser, EnvEntry } from '../parser/envParser';
import { ServerlessParser } from '../parser/serverlessParser';
import { EnvAnalyzer } from '../analyzer/envAnalyzer';
import { isKnownRuntimeVar, getRuntimeVarCategory } from '../constants/knownEnvVars';
import { ConfigLoader } from '../config/configLoader';
import { Logger } from '../utils/logger';

export async function scanCommand(options: { ci?: boolean; strict?: boolean; detectFallbacks?: boolean; commandName?: string }) {
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

  // Print env sources being scanned (matching Pro output style)
  const sources: string[] = [];
  for (const envFile of envFiles) {
    sources.push(path.relative(rootDir, envFile));
  }
  for (const serverlessFile of serverlessFiles) {
    sources.push(path.relative(rootDir, serverlessFile));
  }

  if (sources.length > 0) {
    Logger.info('Scanning env sources:');
    sources.forEach(s => {
      console.log(chalk.dim(`  • ${s}`));
    });
    Logger.blank();
  }

  const parser = new EnvParser();
  const serverlessParser = new ServerlessParser();
  const analyzer = new EnvAnalyzer();

  // UNIFIED APPROACH: Collect all defined variables from ALL sources first
  const allDefinedVars = new Map<string, { key: string; value: string; lineNumber: number; source: string }>();
  const allExampleVars = new Set<string>();

  // Collect from .env files
  for (const envFilePath of envFiles) {
    const definedVars = parser.parse(envFilePath);
    const relativePath = path.relative(rootDir, envFilePath);
    for (const [key, entry] of definedVars.entries()) {
      if (!allDefinedVars.has(key)) {
        allDefinedVars.set(key, { ...entry, source: relativePath });
      }
    }

    // Also collect from .env.example files
    const envDir = path.dirname(envFilePath);
    const examplePath = path.join(envDir, '.env.example');
    const exampleVars = parser.parseExample(examplePath);
    exampleVars.forEach(varName => allExampleVars.add(varName));
  }

  // Collect from serverless.yml files
  for (const serverlessFilePath of serverlessFiles) {
    const serverlessVars = serverlessParser.parse(serverlessFilePath);
    const relativePath = path.relative(rootDir, serverlessFilePath);
    for (const [key, entry] of serverlessVars.entries()) {
      if (!allDefinedVars.has(key)) {
        allDefinedVars.set(key, { key, value: entry.valueExpression || '', lineNumber: entry.lineNumber || 0, source: relativePath });
      }
    }
  }

  // Scan ALL code for environment variable usage
  const allUsedVars = await scanAllCodeForVars(rootDir, scanner, config.exclude);

  // Filter out ignored variables based on config
  const usedVars = new Map<string, { locations: string[], hasFallback: boolean }>();
  const skippedRuntimeVars: Array<{ varName: string; category: string }> = [];

  for (const [varName, usage] of allUsedVars.entries()) {
    const isCustomIgnored = ConfigLoader.shouldIgnoreVar(varName, config);
    const isRuntimeVar = isKnownRuntimeVar(varName);

    // In non-strict mode, skip known runtime variables and custom ignore vars
    if (strictMode || (!isRuntimeVar && !isCustomIgnored)) {
      usedVars.set(varName, usage);
    } else {
      const category = isCustomIgnored ? 'Custom (from config)' : getRuntimeVarCategory(varName);
      if (category) {
        skippedRuntimeVars.push({ varName, category });
      }
    }
  }

  // Convert allDefinedVars to the format expected by analyzer
  const definedVarsForAnalyzer = new Map<string, EnvEntry>();
  for (const [key, entry] of allDefinedVars.entries()) {
    definedVarsForAnalyzer.set(key, { key, value: entry.value, lineNumber: entry.lineNumber });
  }

  // Analyze and find issues (unified - each variable reported only once)
  const result = analyzer.analyze(usedVars, definedVarsForAnalyzer, allExampleVars, detectFallbacks);

  // Group issues by type and severity
  const missingErrors = result.issues.filter(i => i.type === 'missing' && i.severity === 'error');
  const missingWarnings = result.issues.filter(i => i.type === 'missing' && i.severity === 'warning');
  const unusedIssues = result.issues.filter(i => i.type === 'unused');

  // Display issues
  if (missingErrors.length > 0) {
    Logger.error('Missing (not defined in any env source):', true);
    missingErrors.forEach((issue) => {
      Logger.errorItem(issue.varName, 2);
      if (issue.locations && issue.locations.length > 0) {
        Logger.info(`Used in: ${issue.locations.slice(0, 3).join(', ')}${issue.locations.length > 3 ? '...' : ''}`, true);
      }
    });
    Logger.blank();
  }

  if (missingWarnings.length > 0) {
    Logger.warning('Missing (not defined, but has fallback):', true);
    missingWarnings.forEach((issue) => {
      Logger.warningItem(issue.varName, 2);
      if (issue.locations && issue.locations.length > 0) {
        Logger.info(`Used in: ${issue.locations.slice(0, 3).join(', ')}${issue.locations.length > 3 ? '...' : ''}`, true);
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

  // Show skipped runtime variables in non-strict mode
  if (!strictMode && skippedRuntimeVars.length > 0) {
    Logger.info('Skipped known runtime/ignored variables (use --strict to show):', true);
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

  // Display summary
  Logger.divider();
  if (result.issues.length === 0) {
    Logger.summary('No issues found! All environment variables are in sync.');
    return { success: true, issues: [] };
  }

  // Count issues by severity
  const errorCount = result.issues.filter(i => i.severity === 'error').length;
  const warningCount = result.issues.filter(i => i.severity === 'warning').length;
  const infoCount = result.issues.filter(i => i.severity === 'info').length;

  // Summary line matching Pro format
  const parts: string[] = [];
  if (errorCount > 0) parts.push(chalk.red(`Errors: ${errorCount}`));
  if (warningCount > 0) parts.push(chalk.yellow(`Warnings: ${warningCount}`));
  if (infoCount > 0) parts.push(chalk.blue(`Info: ${infoCount}`));
  console.log(parts.join('  '));
  Logger.blank();

  // Suggest fix
  if (!options.ci) {
    const cmdName = options.commandName || 'envguard';
    Logger.info(`Run \`${cmdName} fix\` to auto-generate .env.example files`);
    Logger.blank();
  }

  // Exit with error code in CI mode
  if (options.ci) {
    Logger.error('Issues found. Exiting with error code 1.');
    Logger.blank();
    process.exit(1);
  }

  return { success: false, issues: result.issues };
}

/**
 * Scan all code files in the project for environment variable usage
 */
async function scanAllCodeForVars(
  rootDir: string,
  scanner: CodeScanner,
  excludePatterns: string[] = []
): Promise<Map<string, { locations: string[], hasFallback: boolean }>> {
  const envVars = new Map<string, { locations: string[], hasFallback: boolean }>();

  const pattern = '**/*.{js,ts,jsx,tsx,mjs,cjs}';

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
