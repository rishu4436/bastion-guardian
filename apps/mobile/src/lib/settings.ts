import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { isAddress, normalizeUrl } from "./model";

export interface Settings {
  apiUrl: string;
  webUrl: string;
  /** Watched wallet address. Read-only: the app never holds keys. */
  address: `0x${string}` | null;
}

const KEY = "bastion.settings.v1";
const extra = (Constants.expoConfig?.extra ?? {}) as { defaultApiUrl?: string; defaultWebUrl?: string };

export const DEFAULTS: Settings = {
  apiUrl: extra.defaultApiUrl ?? "http://localhost:4000",
  webUrl: extra.defaultWebUrl ?? "http://localhost:3000",
  address: null,
};

export async function loadSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return DEFAULTS;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      apiUrl: (s.apiUrl && normalizeUrl(s.apiUrl)) || DEFAULTS.apiUrl,
      webUrl: (s.webUrl && normalizeUrl(s.webUrl)) || DEFAULTS.webUrl,
      address: s.address && isAddress(s.address) ? s.address : null,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}
