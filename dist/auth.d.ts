interface StoredTokens {
    access_token: string;
    refresh_token?: string;
    expiry_date?: number;
}
export declare function getStoredTokens(): StoredTokens | null;
export declare function isLoggedIn(): boolean;
export declare function logout(): void;
export declare function getAccessToken(): Promise<string | null>;
export declare function login(): Promise<void>;
export declare function showAuthStatus(): void;
export {};
