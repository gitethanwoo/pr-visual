export type DiffMode = "branch" | "commit" | "staged" | "unstaged";
export declare function detectBestDiffMode(): Promise<{
    mode: DiffMode;
    description: string;
} | null>;
export declare function getDiff(mode: DiffMode, commitHashArg?: string): Promise<string>;
