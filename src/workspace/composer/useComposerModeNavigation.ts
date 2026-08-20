import { inject, provide, type InjectionKey } from "vue"

type ComposerModeNavigation = {
  openCode: () => void
}

const COMPOSER_MODE_NAVIGATION_KEY: InjectionKey<ComposerModeNavigation> = Symbol(
  "aria.composer.mode-navigation",
)

export function provideComposerModeNavigation(value: ComposerModeNavigation) {
  provide(COMPOSER_MODE_NAVIGATION_KEY, value)
}

export function tryUseComposerModeNavigation(): ComposerModeNavigation | null {
  return inject(COMPOSER_MODE_NAVIGATION_KEY, null)
}
