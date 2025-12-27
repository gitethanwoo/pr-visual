import chalk from "chalk";
import gradient from "gradient-string";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// GitHub-inspired: warm orange to cool gray
const prVisualGradient = gradient(["#f78166", "#ffa657", "#8b949e"]);

export interface Spinner {
  stop: () => void;
  update: (text: string) => void;
}

export function createSpinner(text: string): Spinner {
  let frameIndex = 0;
  let currentText = text;
  let stopped = false;
  const isTTY = process.stdout.isTTY;

  // In non-TTY mode (CI, AI agents, pipes), print once and don't animate
  if (!isTTY) {
    console.log(`  ... ${text}`);
    return {
      stop: () => {
        stopped = true;
      },
      update: (newText: string) => {
        // Only print if the message meaningfully changed (not just animation)
        if (newText !== currentText) {
          currentText = newText;
          console.log(`  ... ${newText}`);
        }
      },
    };
  }

  const render = () => {
    if (stopped) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    process.stdout.write(`\r\x1b[K  ${chalk.cyan(frame)} ${currentText}`);
    frameIndex++;
  };

  const interval = setInterval(render, 80);
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
  console.log(prVisualGradient.multiline("  ██████╗ ██████╗       ██╗   ██╗██╗███████╗██╗   ██╗ █████╗ ██╗     \n  ██╔══██╗██╔══██╗      ██║   ██║██║██╔════╝██║   ██║██╔══██╗██║     \n  ██████╔╝██████╔╝█████╗██║   ██║██║███████╗██║   ██║███████║██║     \n  ██╔═══╝ ██╔══██╗╚════╝╚██╗ ██╔╝██║╚════██║██║   ██║██╔══██║██║     \n  ██║     ██║  ██║       ╚████╔╝ ██║███████║╚██████╔╝██║  ██║███████╗\n  ╚═╝     ╚═╝  ╚═╝        ╚═══╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝"));
  console.log();
}

export function printSuccess(text: string): void {
  console.log(chalk.green("  ✓") + " " + text);
}

export function printStep(text: string): void {
  console.log(chalk.dim("  " + text));
}

export function printError(text: string): void {
  console.log(chalk.red("  ✗ ") + text);
}

export function clearLine(): void {
  process.stdout.write("\r" + " ".repeat(60) + "\r");
}
