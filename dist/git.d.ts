export type DiffMode = "branch" | "commit" | "staged" | "unstaged";
export declare function detectBestDiffMode(): Promise<{
    mode: DiffMode;
    description: string;
    commitHash?: string;
}>;
export declare function getDiff(mode: DiffMode, commitHashArg?: string): Promise<string>;
