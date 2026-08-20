import type { DOMWindow } from "jsdom"

export function asMessageEventSource(window: DOMWindow): MessageEventSource {
  return window as unknown as MessageEventSource
}
