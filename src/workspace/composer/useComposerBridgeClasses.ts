/**
 * Live classList reported by the design iframe (`aria:rects.classes`).
 * Used when `class` / `class:list` is expression-valued so the Design tab
 * can show rendered tokens even though source is not a plain string.
 */

import { inject, provide, type InjectionKey, type Ref } from "vue"

export type ComposerBridgeClasses = {
  /** path → per-occurrence classList arrays from the iframe */
  pathClasses: Ref<Record<string, string[][]>>
}

const COMPOSER_BRIDGE_CLASSES_KEY: InjectionKey<ComposerBridgeClasses> =
  Symbol("aria.composer.bridgeClasses")

export function provideComposerBridgeClasses(
  api: ComposerBridgeClasses,
): ComposerBridgeClasses {
  provide(COMPOSER_BRIDGE_CLASSES_KEY, api)
  return api
}

export function tryUseComposerBridgeClasses(): ComposerBridgeClasses | null {
  return inject(COMPOSER_BRIDGE_CLASSES_KEY, null)
}
