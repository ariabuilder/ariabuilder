import { describe, expect, it } from "vitest"
import { reactive } from "vue"
import {
  cloneInferenceDefault,
  isLegacyDisabledModelsSchemaError,
  withoutDisabledModelIds,
} from "../workspace/agent/settings/modelAvailability"

describe("model availability compatibility", () => {
  it("copies a reactive default into an IPC-cloneable object", () => {
    const reactiveDefault = reactive({
      instanceId: "2d6f35d8-5c8e-48f3-bbf6-d22682b8c472",
      modelId: "opencode/claude-sonnet-4",
    })
    const copied = cloneInferenceDefault(reactiveDefault)

    expect(copied).toEqual({
      instanceId: "2d6f35d8-5c8e-48f3-bbf6-d22682b8c472",
      modelId: "opencode/claude-sonnet-4",
    })
    expect(() => structuredClone(copied)).not.toThrow()
  })

  it("recognizes only the old main-process schema rejection", () => {
    expect(
      isLegacyDisabledModelsSchemaError(
        new Error("unrecognized_keys: Unrecognized key(s): disabledModelIds"),
      ),
    ).toBe(true)
    expect(isLegacyDisabledModelsSchemaError(new Error("Provider failed"))).toBe(false)
  })

  it("removes only disabledModelIds from provider patches", () => {
    const patch = withoutDisabledModelIds({
      inference: {
        default: null,
        providerInstances: {
          "instance-1": {
            enabledModelIds: ["model-a"],
            disabledModelIds: ["model-b"],
          },
          "instance-2": null,
        },
      },
    })
    expect(patch).toEqual({
      inference: {
        default: null,
        providerInstances: {
          "instance-1": { enabledModelIds: ["model-a"] },
          "instance-2": null,
        },
      },
    })
  })
})
