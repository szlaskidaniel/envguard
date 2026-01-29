/**
 * Well-known environment variables that are provided by runtimes and don't need
 * to be explicitly defined in .env or serverless.yml
 */

/**
 * AWS Lambda automatically provides these environment variables
 * https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
 */
export const AWS_PROVIDED_VARS = new Set([
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
  'AWS_LAMBDA_LOG_GROUP_NAME',
  'AWS_LAMBDA_LOG_STREAM_NAME',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_LAMBDA_RUNTIME_API',
  '_HANDLER',
  '_X_AMZN_TRACE_ID',
  'LAMBDA_TASK_ROOT',
  'LAMBDA_RUNTIME_DIR',
  'TZ', // Timezone
]);

/**
 * Common Node.js and development environment variables
 */
export const NODEJS_RUNTIME_VARS = new Set([
  'NODE_ENV',
  'NODE_OPTIONS',
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'PWD',
  'OLDPWD',
  'SHELL',
  'TERM',
]);

/**
 * CI/CD and testing environment variables
 */
export const CI_CD_VARS = new Set([
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'BUILDKITE',
]);

/**
 * Serverless Framework and local development
 */
export const SERVERLESS_FRAMEWORK_VARS = new Set([
  'IS_OFFLINE',
  'SLS_OFFLINE',
  'SERVERLESS_STAGE',
  'SERVERLESS_REGION',
]);

/**
 * Testing framework variables
 */
export const TEST_VARS = new Set([
  'JEST_WORKER_ID',
  'VITEST_WORKER_ID',
  'MOCHA_COLORS',
]);

/**
 * Combine all known runtime variables that don't need to be explicitly defined
 */
export const KNOWN_RUNTIME_VARS = new Set([
  ...AWS_PROVIDED_VARS,
  ...NODEJS_RUNTIME_VARS,
  ...CI_CD_VARS,
  ...SERVERLESS_FRAMEWORK_VARS,
  ...TEST_VARS,
]);

/**
 * Check if a variable is a known runtime variable
 */
export function isKnownRuntimeVar(varName: string): boolean {
  return KNOWN_RUNTIME_VARS.has(varName);
}

/**
 * Get a human-readable category for a known runtime variable
 */
export function getRuntimeVarCategory(varName: string): string | null {
  if (AWS_PROVIDED_VARS.has(varName)) return 'AWS Lambda';
  if (NODEJS_RUNTIME_VARS.has(varName)) return 'Node.js Runtime';
  if (CI_CD_VARS.has(varName)) return 'CI/CD';
  if (SERVERLESS_FRAMEWORK_VARS.has(varName)) return 'Serverless Framework';
  if (TEST_VARS.has(varName)) return 'Testing';
  return null;
}
