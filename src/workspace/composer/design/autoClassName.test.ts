import { describe, expect, it } from "vitest"
import { createAutomaticAriaClassName } from "./autoClassName"

function sequenceRandom(...batches: number[][]) {
  let call = 0
  return (values: Uint8Array) => {
    values.set(batches[call] ?? [])
    call += 1
    return values
  }
}

describe("automatic Inspector class names", () => {
  it("creates an opaque five-character lowercase alphanumeric key", () => {
    const name = createAutomaticAriaClassName(
      new Set(),
      sequenceRandom([0, 1, 2, 26, 35]),
    )
    expect(name).toBe("aria-abc09")
    expect(name).toMatch(/^aria-[a-z0-9]{5}$/)
  })

  it("retries when a generated key collides with a project class", () => {
    expect(createAutomaticAriaClassName(
      new Set(["aria-abcde"]),
      sequenceRandom([0, 1, 2, 3, 4], [5, 6, 7, 8, 9]),
    )).toBe("aria-fghij")
  })

  it("rejects biased bytes before building the key", () => {
    expect(createAutomaticAriaClassName(
      new Set(),
      sequenceRandom([252, 253, 254, 255, 0], [1, 2, 3, 4]),
    )).toBe("aria-abcde")
  })
})
