import type { AppAppearancePrefs } from "../../shared/appearance";

function api() {
  if (!window.aria) {
    throw new Error("Aria desktop bridge is unavailable");
  }
  return window.aria;
}

export function getAppearance(): Promise<AppAppearancePrefs> {
  return api().getAppearance();
}

export function setAppearance(
  prefs: AppAppearancePrefs,
): Promise<AppAppearancePrefs> {
  return api().setAppearance(prefs);
}
