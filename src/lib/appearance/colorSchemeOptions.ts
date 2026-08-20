import type { ColorScheme } from "../../../shared/appearance";
import type { AppIconName } from "@/icons/registry";

export interface ColorSchemeOption {
  readonly label: string;
  readonly value: ColorScheme;
  readonly icon: AppIconName;
}

export const COLOR_SCHEME_OPTIONS = [
  {
    label: "Light",
    value: "light",
    icon: "themeSun",
  },
  {
    label: "Dark",
    value: "dark",
    icon: "themeMoon",
  },
  {
    label: "System",
    value: "system",
    icon: "monitor",
  },
] as const satisfies ReadonlyArray<ColorSchemeOption>;
