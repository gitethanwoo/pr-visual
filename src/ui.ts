import chalk from "chalk";

const SPINNER_FRAMES = ["   ", ".  ", ".. ", "..."];
const BAR_WIDTH = 40;

export interface Spinner {
  stop: () => void;
  update: (text: string) => void;
}

export function createSpinner(text: string): Spinner {
  let frameIndex = 0;
  let currentText = text;
  let stopped = false;

  const render = () => {
    if (stopped) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stdout.write(`\r  ${currentText}${chalk.dim(frame)}`);
    frameIndex++;
  };

  const interval = setInterval(render, 300);
  render();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(currentText.length + 10) + "\r");
    },
    update: (text: string) => {
      currentText = text;
    },
  };
}

export function printBanner(): void {
  console.log();
  console.log(chalk.bold("  pr-visual"));
  console.log();
}

export function printBox(lines: string[]): void {
  const maxLen = Math.max(...lines.map((l) => l.length));
  const top = "  +" + "-".repeat(maxLen + 2) + "+";
  const bottom = top;

  console.log(chalk.dim(top));
  for (const line of lines) {
    const padded = line.padEnd(maxLen);
    console.log(chalk.dim("  | ") + padded + chalk.dim(" |"));
  }
  console.log(chalk.dim(bottom));
}

export function printSuccess(text: string): void {
  console.log(chalk.green("  done.") + " " + text);
}

export function printStep(text: string): void {
  console.log(chalk.dim("  " + text));
}

export function printError(text: string): void {
  console.log(chalk.red("  error: ") + text);
}

export function clearLine(): void {
  process.stdout.write("\r" + " ".repeat(60) + "\r");
}
