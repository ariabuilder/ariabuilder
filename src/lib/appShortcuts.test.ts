import { describe, expect, it } from "vitest"
import {
  APP_SHORTCUT_CHORDS,
  matchAppShortcutId,
  type ShortcutInputLike,
} from "../../shared/appShortcuts"

function input(
  key: string,
  overrides: Partial<ShortcutInputLike> = {},
): ShortcutInputLike {
  return {
    type: "keyDown",
    key,
    control: false,
    meta: true,
    alt: false,
    shift: false,
    ...overrides,
  }
}

describe("app rail shortcuts", () => {
  it("maps Command+1 through Command+7 to the seven primary rail items", () => {
    const expected = [
      "railComposer",
      "railPages",
      "railComponents",
      "railLayouts",
      "railCollections",
      "railMedia",
      "railDesign",
    ]

    expect(
      expected.map((_, index) =>
        matchAppShortcutId(input(String(index + 1)), "darwin"),
      ),
    ).toEqual(expected)
  })

  it("maps Command+, to settings", () => {
    expect(matchAppShortcutId(input(","), "darwin")).toBe("settings")
  })

  it("maps Command+/ to Terminal and Command+. to Git", () => {
    expect(matchAppShortcutId(input("/"), "darwin")).toBe("terminal")
    expect(matchAppShortcutId(input("."), "darwin")).toBe("git")
  })

  it("uses Control for the same shortcuts off macOS", () => {
    expect(
      matchAppShortcutId(
        input("1", { meta: false, control: true }),
        "win32",
      ),
    ).toBe("railComposer")
    expect(
      matchAppShortcutId(
        input(",", { meta: false, control: true }),
        "linux",
      ),
    ).toBe("settings")
  })

  it("keeps every shortcut id unique", () => {
    const ids = APP_SHORTCUT_CHORDS.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
