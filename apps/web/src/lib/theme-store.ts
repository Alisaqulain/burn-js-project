import { safeStorage } from "./utils";

export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "bunbench-theme";

/** Dark is the default; a stored "light" preference wins. */
export function initialTheme(): Theme {
  return safeStorage.get(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}
