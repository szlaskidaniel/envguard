export interface EnvUsage {
  varName: string;
  locations: string[];
  hasFallback?: boolean; // Whether the usage has a safe fallback/default
}

export interface EnvDefinition {
  varName: string;
  value?: string;
  comment?: string;
  source?: 'dotenv' | 'serverless' | 'both';
  isReference?: boolean; // For serverless variables that reference external sources
}

export interface Issue {
  type: 'missing' | 'unused' | 'undocumented';
  severity: 'error' | 'warning' | 'info';
  varName: string;
  details: string;
  locations?: string[];
}

export interface ScanResult {
  issues: Issue[];
  usedVars: Map<string, { locations: string[], hasFallback: boolean }>;
  definedVars: Set<string>;
  exampleVars: Set<string>;
}
