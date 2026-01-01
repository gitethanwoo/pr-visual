import chalk from "chalk";
import gradient from "gradient-string";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// GitHub-inspired: warm orange to cool gray
const prVisualGradient = gradient(["#f78166", "#ffa657", "#8b949e"]);
export function createSpinner(text) {
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
            update: (newText) => {
                // Only print if the message meaningfully changed (not just animation)
                if (newText !== currentText) {
                    currentText = newText;
                    console.log(`  ... ${newText}`);
                }
            },
        };
    }
    const render = () => {
        if (stopped)
            return;
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
        update: (text) => {
            currentText = text;
        },
    };
}
export function printBanner() {
    console.log();
    console.log(prVisualGradient.multiline("  ██████╗ ██████╗       ██╗   ██╗██╗███████╗██╗   ██╗ █████╗ ██╗     \n  ██╔══██╗██╔══██╗      ██║   ██║██║██╔════╝██║   ██║██╔══██╗██║     \n  ██████╔╝██████╔╝█████╗██║   ██║██║███████╗██║   ██║███████║██║     \n  ██╔═══╝ ██╔══██╗╚════╝╚██╗ ██╔╝██║╚════██║██║   ██║██╔══██║██║     \n  ██║     ██║  ██║       ╚████╔╝ ██║███████║╚██████╔╝██║  ██║███████╗\n  ╚═╝     ╚═╝  ╚═╝        ╚═══╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝"));
    console.log();
}
export function printSuccess(text) {
    console.log(chalk.green("  ✓") + " " + text);
}
export function printStep(text) {
    console.log(chalk.dim("  " + text));
}
export function printError(text) {
    console.log(chalk.red("  ✗ ") + text);
}
export function clearLine() {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
}
