import * as fs from 'fs';
import * as path from 'path';

export interface EnvGuardConfig {
  /**
   * Custom environment variables to ignore in non-strict mode
   * These will be treated like AWS_REGION, NODE_ENV, etc.
   */
  ignoreVars?: string[];

  /**
   * File patterns to exclude from scanning (in addition to defaults)
   */
  exclude?: string[];

  /**
   * Enable strict mode by default
   */
  strict?: boolean;
}

const DEFAULT_CONFIG: EnvGuardConfig = {
  ignoreVars: [],
  exclude: [],
  strict: false,
};

const CONFIG_FILE_NAMES = [
  '.envguardrc.json',
  '.envguardrc',
  'envguard.config.json',
];

/**
 * Load EnvGuard configuration from various sources
 * Priority: CLI args > .envguardrc.json > package.json > defaults
 */
export class ConfigLoader {
  /**
   * Load config from the project root directory
   */
  static loadConfig(rootDir: string): EnvGuardConfig {
    // Try to find config file
    const configPath = this.findConfigFile(rootDir);

    if (configPath) {
      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(fileContent) as EnvGuardConfig;

        return {
          ...DEFAULT_CONFIG,
          ...userConfig,
          ignoreVars: [
            ...(DEFAULT_CONFIG.ignoreVars || []),
            ...(userConfig.ignoreVars || []),
          ],
          exclude: [
            ...(DEFAULT_CONFIG.exclude || []),
            ...(userConfig.exclude || []),
          ],
        };
      } catch (error) {
        console.warn(`Warning: Failed to parse config file ${configPath}:`, error);
        return DEFAULT_CONFIG;
      }
    }

    // Try to load from package.json
    const packageJsonPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.envguard) {
          const userConfig = packageJson.envguard as EnvGuardConfig;
          return {
            ...DEFAULT_CONFIG,
            ...userConfig,
            ignoreVars: [
              ...(DEFAULT_CONFIG.ignoreVars || []),
              ...(userConfig.ignoreVars || []),
            ],
            exclude: [
              ...(DEFAULT_CONFIG.exclude || []),
              ...(userConfig.exclude || []),
            ],
          };
        }
      } catch (error) {
        // Silently fail if package.json doesn't have envguard config
      }
    }

    return DEFAULT_CONFIG;
  }

  /**
   * Find the config file by searching up the directory tree
   * This allows placing config at repo root and using it in subdirectories
   */
  private static findConfigFile(startDir: string): string | null {
    let currentDir = startDir;
    const root = path.parse(currentDir).root;

    // Search up the directory tree until we hit the filesystem root
    while (currentDir !== root) {
      for (const fileName of CONFIG_FILE_NAMES) {
        const configPath = path.join(currentDir, fileName);
        if (fs.existsSync(configPath)) {
          return configPath;
        }
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached the root
      }
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Check if a variable should be ignored based on config
   */
  static shouldIgnoreVar(varName: string, config: EnvGuardConfig): boolean {
    return config.ignoreVars?.includes(varName) || false;
  }
}
