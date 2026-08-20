<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  useAppearance,
  type ColorScheme,
  type FontFamily,
  type StudioLocalePreference,
  type ThemeId,
} from "@/composables/useAppearance"
import { COLOR_SCHEME_OPTIONS } from "@/lib/appearance/colorSchemeOptions"
import { THEME_OPTIONS } from "@/lib/appearance/themeRegistry"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import { m } from "@/paraglide/messages.js"

const { settings, studioLocale, isLoading, updateAppearance, updateStudioLocale } =
  useAppearance()

const paletteOptions = THEME_OPTIONS

const colorModeOptions = computed(() =>
  COLOR_SCHEME_OPTIONS.map((option) => ({
    ...option,
    label:
      option.value === "light"
        ? m.settings_appearance_mode_light()
        : option.value === "dark"
          ? m.settings_appearance_mode_dark()
          : m.settings_appearance_mode_system(),
  })),
)

const zoomOptions = [
  { label: "XS", value: 0.9 },
  { label: "SM", value: 0.95 },
  { label: "MD", value: 1 },
  { label: "LG", value: 1.1 },
  { label: "XL", value: 1.2 },
] as const

const themeIdModel = computed<ThemeId>({
  get: () => settings.value.themeId,
  set: (value) => {
    void updateAppearance({ themeId: value })
  },
})

const colorSchemeModel = computed<ColorScheme>({
  get: () => settings.value.colorScheme,
  set: (value) => {
    void updateAppearance({ colorScheme: value })
  },
})

const fontFamilyModel = computed<FontFamily>({
  get: () => settings.value.fontFamily,
  set: (value) => {
    void updateAppearance({ fontFamily: value })
  },
})

const uiZoomModel = computed<string>({
  get: () => String(settings.value.uiZoom),
  set: (value) => {
    const match = zoomOptions.find((option) => String(option.value) === value)
    if (match) {
      void updateAppearance({ uiZoom: match.value })
    }
  },
})

const studioLocaleModel = computed<StudioLocalePreference>({
  get: () => studioLocale.value,
  set: (next) => {
    updateStudioLocale(next)
  },
})
</script>

<template>
  <div
    class="space-y-10"
    role="form"
    :aria-label="m.settings_appearance_form_label()"
    :aria-busy="isLoading"
  >
    <SettingsRow
      :label="m.settings_appearance_theme()"
      :description="m.settings_appearance_theme_description()"
      input-id="appearance-theme-id"
    >
      <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
        <div
          id="appearance-theme-id"
          class="grid w-51 grid-cols-3 gap-3"
          role="radiogroup"
          :aria-label="m.settings_appearance_theme_palette()"
        >
          <Tooltip v-for="theme in paletteOptions" :key="theme.id">
            <TooltipTrigger as-child>
              <button
                type="button"
                role="radio"
                :disabled="isLoading"
                :aria-checked="themeIdModel === theme.id"
                :aria-label="theme.label"
                class="h-10 w-15 cursor-pointer select-none rounded-sm border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                :class="
                  themeIdModel === theme.id
                    ? 'border-solid border-primary/80'
                    : 'border-dashed border-border/50 hover:border-solid hover:border-border'
                "
                :style="{ backgroundColor: theme.primaryColor }"
                @click="themeIdModel = theme.id"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{{ theme.label }}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </SettingsRow>

    <SettingsRow
      :label="m.settings_appearance_color_mode()"
      :description="m.settings_appearance_color_mode_description()"
      input-id="appearance-color-scheme"
    >
      <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
        <div
          id="appearance-color-scheme"
          class="grid w-51 grid-cols-3 gap-3"
          role="radiogroup"
          :aria-label="m.settings_appearance_color_mode()"
        >
          <Tooltip v-for="mode in colorModeOptions" :key="mode.value">
            <TooltipTrigger as-child>
              <button
                type="button"
                role="radio"
                :disabled="isLoading"
                :aria-checked="colorSchemeModel === mode.value"
                :aria-label="mode.label"
                class="flex h-10 w-15 cursor-pointer select-none items-center justify-center rounded-sm border bg-input transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                :class="
                  colorSchemeModel === mode.value
                    ? 'border-solid border-primary/80 bg-background! text-foreground'
                    : 'border-dashed border-border/50 text-muted-foreground hover:border-solid hover:border-border hover:bg-background hover:text-foreground'
                "
                @click="colorSchemeModel = mode.value"
              >
                <AppIcon :name="mode.icon" :size="20" class="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{{ mode.label }}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </SettingsRow>

    <SettingsRow
      :label="m.appearance_interface_language()"
      :description="m.appearance_interface_language_description()"
      input-id="appearance-interface-language"
    >
      <Select
        :model-value="studioLocaleModel"
        :disabled="isLoading"
        @update:model-value="
          (v) => {
            if (v === 'system' || v === 'en' || v === 'fr') studioLocaleModel = v
          }
        "
      >
        <SelectTrigger
          id="appearance-interface-language"
          class="w-74! bg-input"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{{
            m.appearance_system_language()
          }}</SelectItem>
          <SelectItem value="en">{{
            m.settings_appearance_language_english()
          }}</SelectItem>
          <SelectItem value="fr">{{
            m.settings_appearance_language_french()
          }}</SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>

    <SettingsRow
      :label="m.settings_appearance_typography()"
      :description="m.settings_appearance_typography_description()"
      input-id="appearance-typography"
    >
      <div class="flex flex-col gap-7">
        <Select
          :model-value="fontFamilyModel"
          :disabled="isLoading"
          @update:model-value="
            (v) => {
              if (
                v === 'Outfit' ||
                v === 'Inter' ||
                v === 'System' ||
                v === 'Monospace'
              ) {
                fontFamilyModel = v
              }
            }
          "
        >
          <SelectTrigger
            class="w-74! overflow-hidden rounded-md hover:bg-background! bg-input! border-border/50 hover:border-solid text-sm font-sans"
          >
            <SelectValue :placeholder="m.settings_appearance_select_font()" />
          </SelectTrigger>
          <SelectContent class="font-sans text-sm">
            <SelectItem value="Outfit">{{
              m.settings_appearance_font_outfit()
            }}</SelectItem>
            <SelectItem value="Inter">Inter</SelectItem>
            <SelectItem value="System">{{
              m.settings_appearance_font_system()
            }}</SelectItem>
            <SelectItem value="Monospace">{{
              m.settings_appearance_font_monospace()
            }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingsRow>

    <SettingsRow
      :label="m.settings_appearance_interface_scale()"
      :description="m.settings_appearance_interface_scale_description()"
      input-id="appearance-scale"
    >
      <div
        id="appearance-scale"
        class="grid w-70 grid-cols-5 gap-2"
        role="radiogroup"
        :aria-label="m.settings_appearance_interface_scale()"
      >
        <button
          v-for="zoom in zoomOptions"
          :key="zoom.value"
          type="button"
          role="radio"
          :disabled="isLoading"
          :aria-checked="settings.uiZoom === zoom.value"
          :aria-label="zoom.label"
          class="flex w-full cursor-pointer select-none items-center justify-center rounded-sm border py-2 text-center font-sans text-xs font-medium tracking-wider shadow-none transition-[color,background-color,border-color] duration-100 disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            settings.uiZoom === zoom.value
              ? 'border-solid border-primary bg-background text-foreground'
              : 'border-dashed border-border/50 bg-input text-muted-foreground/80 hover:border-solid hover:border-border/50 hover:bg-background hover:text-foreground'
          "
          @click="uiZoomModel = String(zoom.value)"
        >
          {{ zoom.label }}
        </button>
      </div>
    </SettingsRow>
  </div>
</template>
