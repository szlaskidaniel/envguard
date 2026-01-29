import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface ServerlessEnvEntry {
  key: string;
  valueExpression: string; // e.g., "${ssm:/path}" or "hardcoded-value"
  isReference: boolean; // true if it references SSM, secrets manager, etc.
  source: string; // file path
  lineNumber?: number;
}

// CloudFormation intrinsic function types for js-yaml
const CF_SCHEMA = yaml.FAILSAFE_SCHEMA.extend([
  new yaml.Type('!Ref', { kind: 'scalar', construct: (data) => ({ Ref: data }) }),
  new yaml.Type('!GetAtt', { kind: 'scalar', construct: (data) => ({ 'Fn::GetAtt': data }) }),
  new yaml.Type('!GetAtt', { kind: 'sequence', construct: (data) => ({ 'Fn::GetAtt': data }) }),
  new yaml.Type('!Join', { kind: 'sequence', construct: (data) => ({ 'Fn::Join': data }) }),
  new yaml.Type('!Sub', { kind: 'scalar', construct: (data) => ({ 'Fn::Sub': data }) }),
  new yaml.Type('!Sub', { kind: 'sequence', construct: (data) => ({ 'Fn::Sub': data }) }),
  new yaml.Type('!ImportValue', { kind: 'scalar', construct: (data) => ({ 'Fn::ImportValue': data }) }),
  new yaml.Type('!Select', { kind: 'sequence', construct: (data) => ({ 'Fn::Select': data }) }),
  new yaml.Type('!Split', { kind: 'sequence', construct: (data) => ({ 'Fn::Split': data }) }),
  new yaml.Type('!FindInMap', { kind: 'sequence', construct: (data) => ({ 'Fn::FindInMap': data }) }),
  new yaml.Type('!GetAZs', { kind: 'scalar', construct: (data) => ({ 'Fn::GetAZs': data }) }),
  new yaml.Type('!Base64', { kind: 'scalar', construct: (data) => ({ 'Fn::Base64': data }) }),
  new yaml.Type('!Equals', { kind: 'sequence', construct: (data) => ({ 'Fn::Equals': data }) }),
  new yaml.Type('!Not', { kind: 'sequence', construct: (data) => ({ 'Fn::Not': data }) }),
  new yaml.Type('!And', { kind: 'sequence', construct: (data) => ({ 'Fn::And': data }) }),
  new yaml.Type('!Or', { kind: 'sequence', construct: (data) => ({ 'Fn::Or': data }) }),
  new yaml.Type('!If', { kind: 'sequence', construct: (data) => ({ 'Fn::If': data }) }),
  new yaml.Type('!Condition', { kind: 'scalar', construct: (data) => ({ Condition: data }) }),
]);

export class ServerlessParser {
  /**
   * Parse a serverless.yml file and extract environment variables
   * from the provider.environment section
   */
  parse(filePath: string): Map<string, ServerlessEnvEntry> {
    const envVars = new Map<string, ServerlessEnvEntry>();

    if (!fs.existsSync(filePath)) {
      return envVars;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const doc = yaml.load(content, { schema: CF_SCHEMA }) as any;

      if (!doc || typeof doc !== 'object') {
        return envVars;
      }

      // Extract from provider.environment
      const providerEnv = doc.provider?.environment;
      if (providerEnv && typeof providerEnv === 'object') {
        for (const [key, value] of Object.entries(providerEnv)) {
          // Only include uppercase env var names (convention)
          if (this.isValidEnvVarName(key)) {
            const valueStr = String(value);
            envVars.set(key, {
              key,
              valueExpression: valueStr,
              isReference: this.isReference(valueStr),
              source: filePath,
            });
          }
        }
      }

      // Also check for function-level environment variables
      const functions = doc.functions;
      if (functions && typeof functions === 'object') {
        for (const [funcName, funcConfig] of Object.entries(functions)) {
          const funcEnv = (funcConfig as any)?.environment;
          if (funcEnv && typeof funcEnv === 'object') {
            for (const [key, value] of Object.entries(funcEnv)) {
              if (this.isValidEnvVarName(key)) {
                const valueStr = String(value);
                // Don't overwrite if already exists from provider level
                if (!envVars.has(key)) {
                  envVars.set(key, {
                    key,
                    valueExpression: valueStr,
                    isReference: this.isReference(valueStr),
                    source: `${filePath} (function: ${funcName})`,
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing ${filePath}:`, error);
    }

    return envVars;
  }

  /**
   * Check if a value references external sources like SSM, Secrets Manager, etc.
   */
  private isReference(value: string): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    // Check for common serverless variable patterns
    const referencePatterns = [
      /\$\{ssm:/,           // SSM Parameter Store
      /\$\{aws:reference/,  // AWS reference
      /\$\{file\(/,         // File reference
      /\$\{self:custom\./,  // Custom variables
      /\$\{opt:/,           // CLI options
      /\$\{env:/,           // Environment variables
      /\$\{cf:/,            // CloudFormation outputs
    ];

    return referencePatterns.some(pattern => pattern.test(value));
  }

  /**
   * Validate if a key is a valid environment variable name
   */
  private isValidEnvVarName(key: string): boolean {
    // Environment variables should typically be uppercase with underscores
    // But we'll be flexible and accept mixed case
    return /^[A-Z_][A-Z0-9_]*$/i.test(key);
  }

  /**
   * Find all serverless.yml files in a directory
   */
  async findServerlessFiles(rootDir: string): Promise<string[]> {
    const { glob } = await import('glob');

    const files = await glob('**/serverless.{yml,yaml}', {
      cwd: rootDir,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      absolute: true,
    });

    return files;
  }
}
