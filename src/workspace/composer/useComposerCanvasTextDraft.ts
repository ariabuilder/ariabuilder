import { inject, provide, ref, type InjectionKey, type Ref } from "vue"
import type { CanvasTextSessionState } from "../../../shared/composer/canvasText"

export type ComposerCanvasTextDraftContext = {
  session: Ref<CanvasTextSessionState | null>
}

const key: InjectionKey<ComposerCanvasTextDraftContext> = Symbol("aria.composer.canvas-text")

export function provideComposerCanvasTextDraft(): ComposerCanvasTextDraftContext {
  const context = { session: ref<CanvasTextSessionState | null>(null) }
  provide(key, context)
  return context
}

export function tryUseComposerCanvasTextDraft(): ComposerCanvasTextDraftContext | null {
  return inject(key, null)
}
