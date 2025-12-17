export type DiffMode = "branch" | "commit" | "staged" | "unstaged";
export declare function getDiff(mode: DiffMode): Promise<string>;
