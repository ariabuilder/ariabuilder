import { describe, expect, it } from "vitest"
import {
  buildBackgroundImageValue,
  clearedBackgroundUpdates,
  colorBackgroundUpdates,
  cssToGradient,
  expandBackgroundShorthand,
  extractBackgroundImageUrl,
  gradientBackgroundUpdates,
  gradientToCSS,
  imageBackgroundUpdates,
  inferBackgroundType,
  resolveBackgroundStyleValues,
} from "./backgroundCss"

describe("backgroundCss", () => {
  it("infers mode from color, url, gradient, and empty values", () => {
    expect(inferBackgroundType({})).toBe("none")
    expect(inferBackgroundType({ "background-color": "transparent" })).toBe("none")
    expect(inferBackgroundType({ "background-color": "#111111" })).toBe("color")
    expect(inferBackgroundType({ "background-image": "url(\"/uploads/hero.jpg\")" })).toBe("image")
    expect(inferBackgroundType({
      "background-color": "#111111",
      "background-image": "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    })).toBe("gradient")
  })

  it("round-trips linear and radial gradients", () => {
    const linear = {
      type: "linear" as const,
      angle: 180,
      stops: [
        { color: "#111111", position: 0 },
        { color: "#336699", position: 40 },
        { color: "#ffffff", position: 100 },
      ],
    }
    const linearCss = gradientToCSS(linear)
    expect(linearCss).toBe("linear-gradient(180deg, #111111 0%, #336699 40%, #ffffff 100%)")
    expect(cssToGradient(linearCss)).toEqual(linear)

    const radial = {
      type: "radial" as const,
      stops: [
        { color: "red", position: 0 },
        { color: "blue", position: 100 },
      ],
    }
    const radialCss = gradientToCSS(radial)
    expect(radialCss).toBe("radial-gradient(circle, red 0%, blue 100%)")
    expect(cssToGradient(radialCss)).toMatchObject({ type: "radial", stops: radial.stops })
  })

  it("wraps bare image URLs and unwraps url() values", () => {
    expect(buildBackgroundImageValue("https://cdn.example/hero.jpg")).toBe(
      'url("https://cdn.example/hero.jpg")',
    )
    expect(buildBackgroundImageValue('url("/uploads/hero.jpg")')).toBe('url("/uploads/hero.jpg")')
    expect(buildBackgroundImageValue("linear-gradient(90deg, red, blue)")).toBe(
      "linear-gradient(90deg, red, blue)",
    )
    expect(extractBackgroundImageUrl('url("/uploads/hero.jpg")')).toBe("/uploads/hero.jpg")
    expect(extractBackgroundImageUrl("https://cdn.example/hero.jpg")).toBe(
      "https://cdn.example/hero.jpg",
    )
  })

  it("clears all longhands for none and omits CSS defaults for attachment/blend", () => {
    expect(clearedBackgroundUpdates()).toEqual({
      background: "",
      "background-color": "",
      "background-image": "",
      "background-size": "",
      "background-position": "",
      "background-repeat": "",
      "background-attachment": "",
      "background-blend-mode": "",
    })

    const color = colorBackgroundUpdates("#ff00aa")
    expect(color["background-color"]).toBe("#ff00aa")
    expect(color["background-image"]).toBe("")

    const gradient = gradientBackgroundUpdates("linear-gradient(90deg, #000 0%, #fff 100%)")
    expect(gradient["background-image"]).toBe("linear-gradient(90deg, #000 0%, #fff 100%)")
    expect(gradient["background-color"]).toBeUndefined()
    expect(gradient["background-blend-mode"]).toBe("")

    const image = imageBackgroundUpdates({
      url: "/uploads/hero.jpg",
      size: "cover",
      position: "center",
      repeat: "no-repeat",
      attachment: "scroll",
      blendMode: "normal",
    })
    expect(image["background-image"]).toBe('url("/uploads/hero.jpg")')
    expect(image["background-size"]).toBe("cover")
    expect(image["background-position"]).toBe("center")
    expect(image["background-repeat"]).toBe("no-repeat")
    expect(image["background-attachment"]).toBe("")
    expect(image["background-blend-mode"]).toBe("")
  })

  it("keeps non-default attachment and blend on image commits", () => {
    const image = imageBackgroundUpdates({
      url: "/uploads/hero.jpg",
      size: "contain",
      position: "top left",
      repeat: "repeat-x",
      attachment: "fixed",
      blendMode: "multiply",
    })
    expect(image["background-attachment"]).toBe("fixed")
    expect(image["background-blend-mode"]).toBe("multiply")
  })

  it("expands background shorthand into longhands", () => {
    expect(expandBackgroundShorthand("red")).toEqual({ "background-color": "red" })
    expect(expandBackgroundShorthand("linear-gradient(90deg, #000 0%, #fff 100%)")).toEqual({
      "background-image": "linear-gradient(90deg, #000 0%, #fff 100%)",
    })
    expect(expandBackgroundShorthand('url("/uploads/hero.jpg")')).toEqual({
      "background-image": 'url("/uploads/hero.jpg")',
    })
    expect(expandBackgroundShorthand('url("/uploads/hero.jpg") center / cover no-repeat')).toEqual({
      "background-image": 'url("/uploads/hero.jpg")',
      "background-size": "cover",
      "background-position": "center",
      "background-repeat": "no-repeat",
    })
  })

  it("infers mode from background shorthand and prefers authored longhands", () => {
    expect(inferBackgroundType({ background: "red" })).toBe("color")
    expect(inferBackgroundType({
      background: "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    })).toBe("gradient")
    expect(inferBackgroundType({ background: 'url("/uploads/hero.jpg")' })).toBe("image")
    expect(inferBackgroundType({
      background: "red",
      "background-image": 'url("/uploads/hero.jpg")',
    })).toBe("image")
    expect(resolveBackgroundStyleValues({
      background: 'url("/uploads/hero.jpg") center / 100% 100% no-repeat',
      "background-color": "#111111",
    })).toMatchObject({
      "background-color": "#111111",
      "background-image": 'url("/uploads/hero.jpg")',
      "background-size": "100% 100%",
      "background-position": "center",
      "background-repeat": "no-repeat",
    })
  })
})
