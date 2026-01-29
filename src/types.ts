export interface EnvUsage {
  varName: string;
  locations: string[];
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
  varName: string;
  details: string;
  locations?: string[];
}

export interface ScanResult {
  issues: Issue[];
  usedVars: Map<string, string[]>;
  definedVars: Set<string>;
  exampleVars: Set<string>;
}
