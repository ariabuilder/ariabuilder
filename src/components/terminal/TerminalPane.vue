<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"
import "@xterm/xterm/css/xterm.css"

const props = defineProps<{
  projectPath: string
  active: boolean
}>()

const emit = defineEmits<{
  ready: [cwd: string]
  exited: []
}>()

const hostRef = ref<HTMLElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
let unsubData: (() => void) | null = null
let unsubExit: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let disposed = false

function resolveCssColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const probe = document.createElement("span")
  probe.style.color = `var(${varName})`
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color || fallback
  probe.remove()
  return color
}

function buildTheme(): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
} {
  const background = resolveCssColor("--popover", "#141414")
  const foreground = resolveCssColor("--popover-foreground", "#e8e8e8")
  const muted = resolveCssColor("--muted-foreground", "#888888")
  const primary = resolveCssColor("--primary", foreground)
  return {
    background,
    foreground,
    cursor: primary,
    cursorAccent: background,
    selectionBackground: muted,
    selectionForeground: foreground,
  }
}

function applyTheme() {
  if (!term) return
  term.options.theme = buildTheme()
}

async function fitAndResize() {
  if (!term || !fitAddon || !sessionId || !hostRef.value) return
  try {
    fitAddon.fit()
  } catch {
    return
  }
  const cols = term.cols
  const rows = term.rows
  try {
    await window.aria?.terminal.resize(sessionId, cols, rows)
  } catch {
    // Session may have exited.
  }
}

async function attachSession() {
  const api = window.aria?.terminal
  if (!api || !term || !props.projectPath.trim()) return

  const cols = term.cols || 80
  const rows = term.rows || 24
  const info = await api.create(props.projectPath, cols, rows)
  if (disposed) {
    void api.dispose(info.id)
    return
  }
  sessionId = info.id
  emit("ready", info.cwd)

  unsubData = api.onData((payload) => {
    if (payload.id !== sessionId || !term) return
    term.write(payload.data)
  })
  unsubExit = api.onExit((payload) => {
    if (payload.id !== sessionId) return
    sessionId = null
    term?.writeln(`\r\n[process exited with code ${payload.exitCode}]`)
    emit("exited")
  })
}

function teardownSession(kill: boolean) {
  unsubData?.()
  unsubData = null
  unsubExit?.()
  unsubExit = null
  const id = sessionId
  sessionId = null
  if (kill && id) {
    void window.aria?.terminal.dispose(id)
  }
}

async function ensureSession() {
  if (!term || sessionId) {
    await fitAndResize()
    term?.focus()
    return
  }
  await attachSession()
  await fitAndResize()
  term?.focus()
}

async function restart() {
  const api = window.aria?.terminal
  if (!api || !term) return
  const cols = term.cols || 80
  const rows = term.rows || 24
  term.reset()
  try {
    if (sessionId) {
      const info = await api.restart(sessionId, cols, rows)
      sessionId = info.id
      emit("ready", info.cwd)
    } else {
      await attachSession()
    }
  } catch {
    sessionId = null
    await attachSession()
  }
  await fitAndResize()
  term.focus()
}

/** Write a command + Enter into the live PTY (after ensuring a session). */
async function runCommand(command: string) {
  const trimmed = command.trim()
  if (!trimmed) return
  await ensureSession()
  if (!sessionId) return
  // Interrupt any in-progress line/job so the helper lands on a clean prompt.
  await window.aria?.terminal.write(sessionId, "\u0003")
  await new Promise((r) => setTimeout(r, 40))
  await window.aria?.terminal.write(sessionId, `${trimmed}\r`)
  term?.focus()
}

defineExpose({
  restart,
  fit: fitAndResize,
  focus: () => term?.focus(),
  runCommand,
})

onMounted(async () => {
  disposed = false
  const host = hostRef.value
  if (!host) return

  term = new Terminal({
    allowProposedApi: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.35,
    theme: buildTheme(),
  })
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(host)

  term.onData((data) => {
    if (!sessionId) return
    void window.aria?.terminal.write(sessionId, data)
  })

  resizeObserver = new ResizeObserver(() => {
    void fitAndResize()
  })
  resizeObserver.observe(host)

  await nextTick()
  if (props.active) {
    await ensureSession()
  }
})

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    applyTheme()
    await nextTick()
    await ensureSession()
  },
)

watch(
  () => props.projectPath,
  async (next, prev) => {
    if (!next || next === prev) return
    // One session per project path: dispose previous cwd PTY and start fresh.
    teardownSession(true)
    term?.reset()
    if (props.active) {
      await ensureSession()
    }
  },
)

onBeforeUnmount(() => {
  disposed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  // The flyout keeps this component mounted while hidden. Reaching unmount now
  // means the owning workspace session is actually ending.
  teardownSession(true)
  term?.dispose()
  term = null
  fitAddon = null
})
</script>

<template>
  <div
    ref="hostRef"
    class="terminal-pane h-full w-full overflow-hidden [&_.xterm]:h-full [&_.xterm-viewport]:bg-transparent!"
  />
</template>
