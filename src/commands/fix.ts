import * as path from 'path';
import * as fs from 'fs';
import { CodeScanner } from '../scanner/codeScanner';
import { EnvParser } from '../parser/envParser';
import { EnvAnalyzer } from '../analyzer/envAnalyzer';
import { Logger } from '../utils/logger';

export async function fixCommand() {
  const rootDir = process.cwd();

  Logger.startSpinner('Generating .env.example files...');

  // Step 1: Find all .env files
  const scanner = new CodeScanner(rootDir);
  const envFiles = await scanner.findEnvFiles();

  Logger.stopSpinner();

  if (envFiles.length === 0) {
    Logger.warning('No .env files found in the project');
    Logger.blank();
    return { success: false };
  }

  Logger.success(`Found ${envFiles.length} .env file(s)`);
  Logger.blank();

  const parser = new EnvParser();
  const analyzer = new EnvAnalyzer();
  let totalVars = 0;

  // Step 2: Process each .env file
  for (const envFilePath of envFiles) {
    const envDir = path.dirname(envFilePath);
    const relativePath = path.relative(rootDir, envDir);
    const displayPath = relativePath || '.';

    Logger.path(`Processing ${displayPath}/`);

    // Step 3: Scan code files in this directory and subdirectories
    const usedVars = await scanDirectoryForVars(rootDir, envDir, scanner);

    if (usedVars.size === 0) {
      Logger.info('No environment variables found in code', true);
      Logger.blank();
      continue;
    }

    Logger.success(`Found ${usedVars.size} variable(s) used in this directory`, true);
    Logger.blank();

    // Step 4: Parse existing .env.example to preserve comments
    const examplePath = path.join(envDir, '.env.example');
    const existingEntries = parser.parse(examplePath);

    // Step 5: Generate new .env.example content
    const newContent = analyzer.generateExampleContent(usedVars, existingEntries);

    // Step 6: Write to .env.example
    fs.writeFileSync(examplePath, newContent, 'utf-8');

    Logger.success(`Generated ${path.relative(rootDir, examplePath)}`, true);
    Logger.blank();

    totalVars += usedVars.size;

    // Step 7: Show summary for this directory
    const definedVars = parser.parse(envFilePath);
    const missingFromEnv = Array.from(usedVars.keys()).filter(v => !definedVars.has(v));

    if (missingFromEnv.length > 0) {
      Logger.warning(`Missing from .env: ${missingFromEnv.join(', ')}`, true);
      Logger.blank();
    }
  }

  Logger.summary(`Generated ${envFiles.length} .env.example file(s) with ${totalVars} total variables`);

  return { success: true };
}

async function scanDirectoryForVars(
  rootDir: string,
  targetDir: string,
  scanner: CodeScanner
): Promise<Map<string, string[]>> {
  const envVars = new Map<string, string[]>();
  const { glob } = require('glob');

  // Find all code files in this directory and subdirectories
  const relativeDir = path.relative(rootDir, targetDir);
  const pattern = relativeDir ? `${relativeDir}/**/*.{js,ts,jsx,tsx,mjs,cjs}` : '**/*.{js,ts,jsx,tsx,mjs,cjs}';

  const files = await glob(pattern, {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    absolute: true,
  });

  for (const file of files) {
    const vars = await (scanner as any).scanFile(file);
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
