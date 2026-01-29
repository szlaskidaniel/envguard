import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ServerlessParser } from '../parser/serverlessParser';

export class CodeScanner {
  private rootDir: string;
  private excludePatterns: string[];
  private serverlessParser: ServerlessParser;

  constructor(rootDir: string, excludePatterns: string[] = ['node_modules', 'dist', 'build', '.git']) {
    this.rootDir = rootDir;
    this.excludePatterns = excludePatterns;
    this.serverlessParser = new ServerlessParser();
  }

  async scan(): Promise<Map<string, string[]>> {
    const envVars = new Map<string, string[]>();

    // Scan for JavaScript/TypeScript files
    const files = await glob('**/*.{js,ts,jsx,tsx,mjs,cjs}', {
      cwd: this.rootDir,
      ignore: this.excludePatterns.map(p => `**/${p}/**`),
      absolute: true,
    });

    for (const file of files) {
      const vars = await this.scanFile(file);
      for (const varName of vars) {
        const relativePath = path.relative(this.rootDir, file);
        if (!envVars.has(varName)) {
          envVars.set(varName, []);
        }
        envVars.get(varName)!.push(relativePath);
      }
    }

    // Also scan serverless.yml files for environment variable definitions
    const serverlessFiles = await this.findServerlessFiles();
    for (const file of serverlessFiles) {
      const vars = this.scanServerlessFile(file);
      for (const [varName, entry] of vars.entries()) {
        const relativePath = path.relative(this.rootDir, file);
        if (!envVars.has(varName)) {
          envVars.set(varName, []);
        }
        envVars.get(varName)!.push(`${relativePath} (serverless config)`);
      }
    }

    return envVars;
  }

  async scanFile(filePath: string): Promise<Set<string>> {
    const envVars = new Set<string>();

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Pattern 1: process.env.VAR_NAME
      const processEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
      let match;

      while ((match = processEnvPattern.exec(content)) !== null) {
        envVars.add(match[1]);
      }

      // Pattern 2: process.env['VAR_NAME'] or process.env["VAR_NAME"]
      const processEnvBracketPattern = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"\]]/g;

      while ((match = processEnvBracketPattern.exec(content)) !== null) {
        envVars.add(match[1]);
      }

      // Pattern 3: Destructuring - const { VAR_NAME } = process.env
      const destructuringPattern = /const\s+\{\s*([^}]+)\s*\}\s*=\s*process\.env/g;

      while ((match = destructuringPattern.exec(content)) !== null) {
        const vars = match[1].split(',').map(v => v.trim().split(':')[0].trim());
        vars.forEach(v => {
          if (/^[A-Z_][A-Z0-9_]*$/.test(v)) {
            envVars.add(v);
          }
        });
      }

    } catch (error) {
      console.error(`Error scanning file ${filePath}:`, error);
    }

    return envVars;
  }

  async findEnvFiles(): Promise<string[]> {
    const envFiles = await glob('**/.env', {
      cwd: this.rootDir,
      ignore: this.excludePatterns.map(p => `**/${p}/**`),
      absolute: true,
    });

    return envFiles;
  }

  async findServerlessFiles(): Promise<string[]> {
    const serverlessFiles = await glob('**/serverless.{yml,yaml}', {
      cwd: this.rootDir,
      ignore: this.excludePatterns.map(p => `**/${p}/**`),
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
    const files = await glob('**/*.{js,ts,jsx,tsx,mjs,cjs}', {
      cwd: this.rootDir,
      ignore: this.excludePatterns.map(p => `**/${p}/**`),
      absolute: true,
    });

    for (const file of files) {
      const vars = await this.scanFile(file);
      const fileDir = path.dirname(file);
      const relativePath = path.relative(this.rootDir, file);

      for (const varName of vars) {
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
