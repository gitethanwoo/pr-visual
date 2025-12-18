import type { VisualStyle } from "./cli.js";
export declare function analyzeDiff(diff: string, style: VisualStyle, retries?: number, onRetry?: (attempt: number, error: Error) => void): Promise<string>;
