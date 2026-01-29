import { scanCommand } from './scan';

export async function checkCommand() {
  // Check command is the same as scan but with --ci flag
  return scanCommand({ ci: true });
}
