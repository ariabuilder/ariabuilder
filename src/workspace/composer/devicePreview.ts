import type { DevicePreview } from "@/workspace/types"

/**
 * Device preview presets (Stacki-style) — not project CSS breakpoints.
 * Design-mode Stage uses `100%` for desktop so the frame can tween with
 * `.t-resize`; the breakpoint board uses the explicit desktop pixel width.
 */
export type BreakpointBoardPreset = {
  id: DevicePreview
  labelKey: "workspace_device_desktop" | "workspace_device_tablet" | "workspace_device_mobile"
  width: number
  viewportHeight: number
}

export const BREAKPOINT_BOARD_PRESETS: readonly BreakpointBoardPreset[] = [
  { id: "desktop", labelKey: "workspace_device_desktop", width: 1440, viewportHeight: 900 },
  { id: "tablet", labelKey: "workspace_device_tablet", width: 768, viewportHeight: 1024 },
  { id: "mobile", labelKey: "workspace_device_mobile", width: 375, viewportHeight: 812 },
]

export const STAGE_DEVICE_WIDTH: Record<DevicePreview, string> = {
  desktop: "100%",
  tablet: `${BREAKPOINT_BOARD_PRESETS[1]!.width}px`,
  mobile: `${BREAKPOINT_BOARD_PRESETS[2]!.width}px`,
}
