/** Shared product branding for About panel, dock icon, and shell chrome. */

export const BRAND_NAME = "Aria";
export const BRAND_SITE_URL = "https://ariabuilder.io";
export const BRAND_SITE_LABEL = "ariabuilder.io";

export function brandCopyright(year = new Date().getFullYear()): string {
  return `Copyright © ${year} Statice Origins Inc`;
}
