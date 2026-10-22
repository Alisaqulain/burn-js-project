import { safeStorage } from "./utils";

const KEY = "bunbench-api-token";

/**
 * The API access token is entered by the operator in Settings and kept only in this browser's
 * storage. It is never baked into the build: VITE_* variables are public in the shipped bundle.
 */
export const apiToken = {
  get: (): string | null => safeStorage.get(KEY),
  set: (token: string): void => safeStorage.set(KEY, token.trim()),
  clear: (): void => safeStorage.remove(KEY),
};
