import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ServerlessParser } from '../parser/serverlessParser';



// Directories that should ALWAYS be excluded (never override these)
const ALWAYS_EXCLUDE = ['node_modules', '.git'];

// Default exclude patterns (can be overridden by user config)
const DEFAULT_EXCLUDE = ['dist', 'build'];

export class CodeScanner {
  private rootDir: string;
  private excludePatterns: string[];
  private serverlessParser: ServerlessParser;

  constructor(rootDir: string, excludePatterns: string[] = DEFAULT_EXCLUDE) {
    this.rootDir = rootDir;
    // Always exclude node_modules and .git, then add user patterns
    this.excludePatterns = [...new Set([...ALWAYS_EXCLUDE, ...excludePatterns])];
    this.serverlessParser = new ServerlessParser();
  }

  async scan(): Promise<Map<string, { locations: string[], hasFallback: boolean }>> {
    const envVars = new Map<string, { locations: string[], hasFallback: boolean }>();

    // Scan for JavaScript/TypeScript files
    // Handle both simple names (e.g., 'node_modules') and glob patterns (e.g., '**/tmp/**')
    const ignorePatterns = this.excludePatterns.map(p =>
      p.includes('*') ? p : `**/${p}/**`
    );

    const files = await glob('**/*.{js,ts,jsx,tsx,mjs,cjs}', {
      cwd: this.rootDir,
      ignore: ignorePatterns,
      absolute: true,
    });

    for (const file of files) {
      const vars = await this.scanFile(file);
      for (const [varName, hasFallback] of vars.entries()) {
        const relativePath = path.relative(this.rootDir, file);
        if (!envVars.has(varName)) {
          envVars.set(varName, { locations: [], hasFallback: false });
        }
        const entry = envVars.get(varName)!;
        entry.locations.push(relativePath);
        // If ANY usage has a fallback, mark it as having a fallback
        entry.hasFallback = entry.hasFallback || hasFallback;
      }
    }

    // Also scan serverless.yml files for environment variable definitions
    const serverlessFiles = await this.findServerlessFiles();
    for (const file of serverlessFiles) {
      const vars = this.scanServerlessFile(file);
      for (const [varName, entry] of vars.entries()) {
        const relativePath = path.relative(this.rootDir, file);
        if (!envVars.has(varName)) {
          envVars.set(varName, { locations: [], hasFallback: false });
        }
        envVars.get(varName)!.locations.push(`${relativePath} (serverless config)`);
      }
    }

    return envVars;
  }

  async scanFile(filePath: string): Promise<Map<string, boolean>> {
    const envVars = new Map<string, boolean>();

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Pattern 1: process.env.VAR_NAME with fallback checks
      // Matches: process.env.VAR || 'default'
      //          process.env.VAR ?? 'default'
      //          process.env.VAR ? x : y
      const processEnvWithFallbackPattern = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(\|\||&&|\?\?|\?)/g;
      let match;

      while ((match = processEnvWithFallbackPattern.exec(content)) !== null) {
        envVars.set(match[1], true); // Has fallback
      }

      // Pattern 2: process.env.VAR in conditional checks
      // Matches: if (process.env.VAR)
      //          if (!process.env.VAR)
      const conditionalPattern = /if\s*\(\s*!?\s*process\.env\.([A-Z_][A-Z0-9_]*)\s*\)/g;

      while ((match = conditionalPattern.exec(content)) !== null) {
        if (!envVars.has(match[1])) {
          envVars.set(match[1], true); // Has conditional check
        }
      }

      // Pattern 3: Destructuring with defaults - const { VAR = 'default' } = process.env
      const destructuringWithDefaultPattern = /const\s+\{\s*([^}]+)\s*\}\s*=\s*process\.env/g;

      while ((match = destructuringWithDefaultPattern.exec(content)) !== null) {
        const vars = match[1].split(',').map(v => v.trim());
        vars.forEach(v => {
          const parts = v.split('=');
          const varName = parts[0].split(':')[0].trim();
          const hasDefault = parts.length > 1;
          if (/^[A-Z_][A-Z0-9_]*$/.test(varName)) {
            if (!envVars.has(varName)) {
              envVars.set(varName, hasDefault);
            }
          }
        });
      }

      // Pattern 4: Optional chaining - process.env?.VAR
      const optionalChainingPattern = /process\.env\?\.([A-Z_][A-Z0-9_]*)/g;

      while ((match = optionalChainingPattern.exec(content)) !== null) {
        if (!envVars.has(match[1])) {
          envVars.set(match[1], true); // Has optional chaining
        }
      }

      // Pattern 5: process.env['VAR_NAME'] or process.env["VAR_NAME"] with fallback
      const processEnvBracketWithFallbackPattern = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"\]]\s*(\|\||&&|\?\?|\?)/g;

      while ((match = processEnvBracketWithFallbackPattern.exec(content)) !== null) {
        envVars.set(match[1], true); // Has fallback
      }

      // Pattern 6: Basic usage without any safety (process.env.VAR)
      // This should come AFTER all the fallback patterns so we don't override them
      const basicProcessEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

      while ((match = basicProcessEnvPattern.exec(content)) !== null) {
        if (!envVars.has(match[1])) {
          envVars.set(match[1], false); // No fallback detected
        }
      }

      // Pattern 7: Basic bracket notation without safety
      const basicBracketPattern = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"\]]/g;

      while ((match = basicBracketPattern.exec(content)) !== null) {
        if (!envVars.has(match[1])) {
          envVars.set(match[1], false); // No fallback detected
        }
      }

    } catch (error) {
      console.error(`Error scanning file ${filePath}:`, error);
    }

    return envVars;
  }

  async findEnvFiles(): Promise<string[]> {
    const ignorePatterns = this.excludePatterns.map(p =>
      p.includes('*') ? p : `**/${p}/**`
    );

    const envFiles = await glob('**/.env', {
      cwd: this.rootDir,
      ignore: ignorePatterns,
      absolute: true,
    });

    return envFiles;
  }

  async findServerlessFiles(): Promise<string[]> {
    const ignorePatterns = this.excludePatterns.map(p =>
      p.includes('*') ? p : `**/${p}/**`
    );

    const serverlessFiles = await glob('**/serverless.{yml,yaml}', {
      cwd: this.rootDir,
      ignore: ignorePatterns,
      absolute: true,
    });

    return serverlessFiles;
  }

  scanServerlessFile(filePath: string): Map<string, any> {
    return this.serverlessParser.parse(filePath);
  }

  async scanByDirectory(): Promise<Map<string, Map<string, string[]>>> {
    // Returns a map of directory -> (varName -> file locations)
    const dirMap = new Map<string, Map<string, string[]>>();

    // Scan for JavaScript/TypeScript files
    const ignorePatterns = this.excludePatterns.map(p =>
      p.includes('*') ? p : `**/${p}/**`
    );

    const files = await glob('**/*.{js,ts,jsx,tsx,mjs,cjs}', {
      cwd: this.rootDir,
      ignore: ignorePatterns,
      absolute: true,
    });

    for (const file of files) {
      const vars = await this.scanFile(file);
      const fileDir = path.dirname(file);
      const relativePath = path.relative(this.rootDir, file);

      for (const [varName, hasFallback] of vars.entries()) {
        if (!dirMap.has(fileDir)) {
          dirMap.set(fileDir, new Map());
        }
        const varMap = dirMap.get(fileDir)!;
        if (!varMap.has(varName)) {
          varMap.set(varName, []);
        }
        varMap.get(varName)!.push(relativePath);
      }
    }

    return dirMap;
  }
}
