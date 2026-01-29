import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { glob } from 'glob';
import { CodeScanner } from '../scanner/codeScanner';
import { EnvParser, EnvEntry } from '../parser/envParser';
import { ServerlessParser } from '../parser/serverlessParser';
import { EnvAnalyzer } from '../analyzer/envAnalyzer';
import { Issue } from '../types';
import { isKnownRuntimeVar, getRuntimeVarCategory } from '../constants/knownEnvVars';
import { ConfigLoader } from '../config/configLoader';

export async function scanCommand(options: { ci?: boolean; strict?: boolean }) {
  const rootDir = process.cwd();

  // Load configuration
  const config = ConfigLoader.loadConfig(rootDir);

  // CLI options override config file
  const strictMode = options.strict !== undefined ? options.strict : config.strict;

  console.log(chalk.blue('🔍 Scanning codebase for environment variables...\n'));

  // Step 1: Find all .env files and serverless.yml files
  const scanner = new CodeScanner(rootDir);
  const envFiles = await scanner.findEnvFiles();
  const serverlessFiles = await scanner.findServerlessFiles();

  if (envFiles.length === 0 && serverlessFiles.length === 0) {
    console.log(chalk.yellow('⚠️  No .env or serverless.yml files found in the project\n'));
    return { success: false, issues: [] };
  }

  console.log(chalk.green(`✓ Found ${envFiles.length} .env file(s) and ${serverlessFiles.length} serverless.yml file(s)\n`));

  const parser = new EnvParser();
  const serverlessParser = new ServerlessParser();
  const analyzer = new EnvAnalyzer();
  const allIssues: Issue[] = [];

  // Step 2a: Process serverless.yml files independently
  for (const serverlessFilePath of serverlessFiles) {
    const serverlessDir = path.dirname(serverlessFilePath);
    const relativePath = path.relative(rootDir, serverlessFilePath);

    console.log(chalk.cyan(`📂 Checking ${relativePath}\n`));

    // Parse serverless.yml
    const serverlessVars = serverlessParser.parse(serverlessFilePath);
    console.log(chalk.gray(`   Found ${serverlessVars.size} variable(s) in serverless.yml`));

    // Scan code files in this directory to see what's actually used
    const usedVars = await scanDirectoryForCodeVars(rootDir, serverlessDir, scanner);
    console.log(chalk.gray(`   Found ${usedVars.size} variable(s) used in code\n`));

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
      console.log(chalk.yellow.bold('   ⚠️  Unused variables in serverless.yml:'));
      unusedServerlessVars.forEach((varName, index) => {
        console.log(chalk.yellow(`      ${index + 1}. ${varName}`));
        allIssues.push({
          type: 'unused',
          varName,
          details: `Defined in serverless.yml but never used in code`,
        });
      });
      console.log();
    }

    if (missingFromServerless.length > 0) {
      console.log(chalk.red.bold('   🚨 Missing from serverless.yml:'));
      missingFromServerless.forEach((item, index) => {
        console.log(chalk.red(`      ${index + 1}. ${item.varName}`));
        if (item.locations && item.locations.length > 0) {
          console.log(chalk.gray(`         Used in: ${item.locations.slice(0, 2).join(', ')}`));
        }
        allIssues.push({
          type: 'missing',
          varName: item.varName,
          details: `Used in code but not defined in serverless.yml`,
          locations: item.locations,
        });
      });
      console.log();
    }

    if (unusedServerlessVars.length === 0 && missingFromServerless.length === 0) {
      console.log(chalk.green('   ✅ No issues in this serverless.yml\n'));
    }

    // Show skipped runtime variables in non-strict mode
    if (!strictMode && skippedRuntimeVars.length > 0) {
      console.log(chalk.gray('   ℹ️  Skipped known runtime variables (use --strict to show):'));
      // Group by category
      const grouped = new Map<string, string[]>();
      for (const { varName, category } of skippedRuntimeVars) {
        if (!grouped.has(category)) {
          grouped.set(category, []);
        }
        grouped.get(category)!.push(varName);
      }
      for (const [category, vars] of grouped.entries()) {
        console.log(chalk.gray(`      ${category}: ${vars.join(', ')}`));
      }
      console.log();
    }
  }

  // Step 2b: Process each .env file (including directories that also have serverless.yml)
  for (const envFilePath of envFiles) {
    const envDir = path.dirname(envFilePath);
    const relativePath = path.relative(rootDir, envDir);
    const displayPath = relativePath || '.';

    console.log(chalk.cyan(`📂 Checking ${displayPath}/\n`));

    // Step 3: Scan code files in this directory and subdirectories
    const usedVars = await scanDirectoryForVars(rootDir, envDir, scanner);

    console.log(chalk.gray(`   Found ${usedVars.size} variable(s) used in this scope`));

    // Step 4: Parse .env file
    const definedVars = parser.parse(envFilePath);
    console.log(chalk.gray(`   Found ${definedVars.size} variable(s) in .env`));

    // Step 5: Parse .env.example
    const examplePath = path.join(envDir, '.env.example');
    const exampleVars = parser.parseExample(examplePath);
    console.log(chalk.gray(`   Found ${exampleVars.size} variable(s) in .env.example\n`));

    // Step 6: Analyze and find issues
    const result = analyzer.analyze(usedVars, definedVars, exampleVars);

    if (result.issues.length > 0) {
      // Group issues by type
      const missingIssues = result.issues.filter(i => i.type === 'missing');
      const unusedIssues = result.issues.filter(i => i.type === 'unused');
      const undocumentedIssues = result.issues.filter(i => i.type === 'undocumented');

      if (missingIssues.length > 0) {
        console.log(chalk.red.bold('   🚨 Missing from .env:'));
        missingIssues.forEach((issue, index) => {
          console.log(chalk.red(`      ${index + 1}. ${issue.varName}`));
          if (issue.locations && issue.locations.length > 0) {
            console.log(chalk.gray(`         Used in: ${issue.locations.slice(0, 2).join(', ')}`));
          }
        });
        console.log();
      }

      if (unusedIssues.length > 0) {
        console.log(chalk.yellow.bold('   ⚠️  Unused variables:'));
        unusedIssues.forEach((issue, index) => {
          console.log(chalk.yellow(`      ${index + 1}. ${issue.varName}`));
        });
        console.log();
      }

      if (undocumentedIssues.length > 0) {
        console.log(chalk.blue.bold('   📝 Missing from .env.example:'));
        undocumentedIssues.forEach((issue, index) => {
          console.log(chalk.blue(`      ${index + 1}. ${issue.varName}`));
        });
        console.log();
      }

      allIssues.push(...result.issues);
    } else {
      console.log(chalk.green('   ✅ No issues in this directory\n'));
    }
  }

  // Display summary
  console.log(chalk.bold('─'.repeat(50)));
  if (allIssues.length === 0) {
    console.log(chalk.green('\n✅ No issues found! All environment variables are in sync.\n'));
    return { success: true, issues: [] };
  }

  console.log(chalk.yellow(`\n⚠️  Total: ${allIssues.length} issue(s) across ${envFiles.length} location(s)\n`));

  // Suggest fix
  if (!options.ci) {
    console.log(chalk.cyan('💡 Run `envguard fix` to auto-generate .env.example files\n'));
  }

  // Exit with error code in CI mode
  if (options.ci) {
    console.log(chalk.red('❌ Issues found. Exiting with error code 1.\n'));
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
