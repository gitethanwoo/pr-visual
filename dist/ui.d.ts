export interface Spinner {
    stop: () => void;
    update: (text: string) => void;
}
export declare function createSpinner(text: string): Spinner;
export declare function printBanner(): void;
export declare function printSuccess(text: string): void;
export declare function printStep(text: string): void;
export declare function printError(text: string): void;
export declare function clearLine(): void;
