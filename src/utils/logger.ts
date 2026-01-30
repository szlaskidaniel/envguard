import chalk from 'chalk';

/**
 * Minimalist red-themed logger inspired by Serverless Framework v4
 * Uses minimal colors and simple symbols for a clean, professional look
 */
export class Logger {
  private static spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static spinnerInterval: NodeJS.Timeout | null = null;
  private static currentFrame = 0;
  private static spinnerMessage = '';

  /**
   * Start an animated spinner with a message
   */
  static startSpinner(message: string) {
    this.spinnerMessage = message;
    this.currentFrame = 0;

    if (this.spinnerInterval) {
      this.stopSpinner();
    }

    process.stdout.write('\n');
    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.currentFrame];
      process.stdout.write(`\r${chalk.dim(frame)} ${this.spinnerMessage}`);
      this.currentFrame = (this.currentFrame + 1) % this.spinnerFrames.length;
    }, 80);
  }

  /**
   * Stop the spinner and clear the line
   */
  static stopSpinner(finalMessage?: string) {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (finalMessage) {
      process.stdout.write(`\r${finalMessage}\n`);
    } else {
      process.stdout.write('\r\x1b[K'); // Clear line
    }
  }

  /**
   * Log a header/section message (minimalist, no icons)
   */
  static header(message: string) {
    console.log(chalk.dim(message));
  }

  /**
   * Log a success message with checkmark
   */
  static success(message: string, indent = false) {
    const prefix = indent ? '   ' : '';
    console.log(`${prefix}${chalk.dim('✔')} ${message}`);
  }

  /**
   * Log an error message (red themed)
   */
  static error(message: string, indent = false) {
    const prefix = indent ? '   ' : '';
    console.log(`${prefix}${chalk.red('✖')} ${chalk.red(message)}`);
  }

  /**
   * Log a warning message (yellow/amber)
   */
  static warning(message: string, indent = false) {
    const prefix = indent ? '   ' : '';
    console.log(`${prefix}${chalk.hex('#FFA500')('⚠')} ${chalk.hex('#FFA500')(message)}`);
  }

  /**
   * Log an info message (very minimal)
   */
  static info(message: string, indent = false) {
    const prefix = indent ? '   ' : '';
    console.log(`${prefix}${chalk.dim(message)}`);
  }

  /**
   * Log a list item (error themed in red)
   */
  static errorItem(message: string, indent = 1) {
    const prefix = '   '.repeat(indent);
    console.log(`${prefix}${chalk.red('•')} ${chalk.red(message)}`);
  }

  /**
   * Log a list item (warning themed, yellow/amber)
   */
  static warningItem(message: string, indent = 1) {
    const prefix = '   '.repeat(indent);
    console.log(`${prefix}${chalk.hex('#FFA500')('•')} ${chalk.hex('#FFA500')(message)}`);
  }

  /**
   * Log a list item (info themed, very dim)
   */
  static infoItem(message: string, indent = 1) {
    const prefix = '   '.repeat(indent);
    console.log(`${prefix}${chalk.dim('•')} ${chalk.dim(message)}`);
  }

  /**
   * Log a divider
   */
  static divider() {
    console.log(chalk.dim('─'.repeat(50)));
  }

  /**
   * Log a blank line
   */
  static blank() {
    console.log();
  }

  /**
   * Log a final summary message (Serverless-style)
   */
  static summary(message: string) {
    console.log(`\n${chalk.dim('✔')} ${message}\n`);
  }

  /**
   * Log a path/file reference (dimmed)
   */
  static path(message: string, indent = false) {
    const prefix = indent ? '   ' : '';
    console.log(`${prefix}${chalk.dim(message)}`);
  }

  /**
   * Log deployment-style message (like "Deploying to stage dev")
   */
  static deployment(message: string) {
    console.log(`\n${message}\n`);
  }
}
