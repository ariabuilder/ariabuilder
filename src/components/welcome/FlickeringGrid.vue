<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from "vue"

type GridState = {
  width: number
  height: number
  columns: number
  rows: number
  opacity: Float32Array
  scale: Float32Array
  accent: Uint8Array
}

const SQUARE_SIZE = 4
const CELL_SIZE = 10

function accentBias(column: number, row: number, columns: number, rows: number) {
  const x = column / Math.max(columns - 1, 1)
  const y = row / Math.max(rows - 1, 1)
  return 0.12 + x * 0.14 + y * 0.1
}

const rootRef = useTemplateRef<HTMLDivElement>("root")

let cleanup: (() => void) | undefined

onMounted(() => {
  const root = rootRef.value
  if (!root) return

  const canvas = root.querySelector("canvas")
  const context = canvas?.getContext("2d")
  if (!canvas || !context) return

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
  let state: GridState | null = null
  let frame: number | null = null
  let resizeFrame: number | null = null
  let lastTime = 0

  const palette = () => {
    const styles = getComputedStyle(root)
    return {
      base: styles.getPropertyValue("--grid-base").trim() || "80 84 88",
      accent: styles.getPropertyValue("--grid-accent").trim() || "13 129 119",
    }
  }

  const assign = (next: GridState, index: number, column: number, row: number) => {
    const accent =
      Math.random() < accentBias(column, row, next.columns, next.rows)
    next.accent[index] = accent ? 1 : 0
    next.opacity[index] =
      Math.pow(Math.random(), accent ? 4.25 : 1.8) * (accent ? 0.54 : 0.2)
    next.scale[index] = accent
      ? 0.68 + Math.random() * 0.32
      : 0.42 + Math.random() * 0.48
  }

  const setup = () => {
    const rect = root.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return

    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (state?.width === width && state.height === height) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.imageSmoothingEnabled = false

    const columns = Math.ceil(width / CELL_SIZE)
    const rows = Math.ceil(height / CELL_SIZE)
    const count = columns * rows
    const next: GridState = {
      width,
      height,
      columns,
      rows,
      opacity: new Float32Array(count),
      scale: new Float32Array(count),
      accent: new Uint8Array(count),
    }

    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        assign(next, column * rows + row, column, row)
      }
    }
    state = next
  }

  const draw = (delta: number, update: boolean) => {
    if (!state) return
    const colors = palette()
    context.clearRect(0, 0, state.width, state.height)

    for (let column = 0; column < state.columns; column++) {
      for (let row = 0; row < state.rows; row++) {
        const index = column * state.rows + row
        if (update && Math.random() < 0.075 * delta) {
          assign(state, index, column, row)
        }

        const size = Math.max(1, Math.round(SQUARE_SIZE * state.scale[index]))
        const offset = Math.round((SQUARE_SIZE - size) / 2)
        const color = state.accent[index] ? colors.accent : colors.base
        context.fillStyle = `rgb(${color} / ${state.opacity[index]})`
        context.fillRect(
          column * CELL_SIZE + offset,
          row * CELL_SIZE + offset,
          size,
          size,
        )
      }
    }
  }

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    lastTime = 0
  }

  const animate = (time: number) => {
    const delta = lastTime ? Math.min((time - lastTime) / 2000, 0.1) : 0
    lastTime = time
    draw(delta, true)
    frame = requestAnimationFrame(animate)
  }

  const render = () => {
    setup()
    draw(0, false)
    stop()
    if (!reducedMotion.matches && !document.hidden && state) {
      frame = requestAnimationFrame(animate)
    }
  }

  const queueRender = () => {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      render()
    })
  }

  const themeObserver = new MutationObserver(queueRender)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  reducedMotion.addEventListener("change", render)
  window.addEventListener("resize", queueRender, { passive: true })
  document.addEventListener("visibilitychange", render)
  render()

  cleanup = () => {
    stop()
    themeObserver.disconnect()
    reducedMotion.removeEventListener("change", render)
    window.removeEventListener("resize", queueRender)
    document.removeEventListener("visibilitychange", render)
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
  }
})

onUnmounted(() => {
  cleanup?.()
})
</script>

<template>
  <div
    ref="root"
    class="pointer-events-none absolute inset-0 overflow-hidden"
    :style="{
      maskImage: `
        radial-gradient(
          ellipse 110% 95% at 50% 28%,
          #000 0%,
          #000 22%,
          rgba(0, 0, 0, 0.55) 52%,
          rgba(0, 0, 0, 0.18) 72%,
          transparent 92%
        ),
        linear-gradient(
          to bottom,
          #000 0%,
          #000 38%,
          rgba(0, 0, 0, 0.7) 58%,
          rgba(0, 0, 0, 0.28) 76%,
          transparent 100%
        )
      `,
      WebkitMaskImage: `
        radial-gradient(
          ellipse 110% 95% at 50% 28%,
          #000 0%,
          #000 22%,
          rgba(0, 0, 0, 0.55) 52%,
          rgba(0, 0, 0, 0.18) 72%,
          transparent 92%
        ),
        linear-gradient(
          to bottom,
          #000 0%,
          #000 38%,
          rgba(0, 0, 0, 0.7) 58%,
          rgba(0, 0, 0, 0.28) 76%,
          transparent 100%
        )
      `,
      maskComposite: 'intersect',
      WebkitMaskComposite: 'source-in',
    }"
    aria-hidden="true"
  >
    <canvas class="block size-full" />
  </div>
</template>
