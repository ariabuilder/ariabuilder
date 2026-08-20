import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_BACKEND_IDS,
  InferenceBackendIdSchema,
  activateConfiguredAgentProviders,
  buildInitialProviderInstance,
  hasEnabledInferenceProvider,
  isDesktopToolAllowed,
  listRecommendedModelIds,
  mergeAgentSettings,
  parseAgentSettings,
  parseAgentRendererHostRegistrationArgs,
  pickRecommendedDefaultModelId,
  reconcileCatalogModelAvailability,
} from "./index";
import {
  listReadyInferenceBackends,
  resolveRequestInference,
} from "../../electron/agent/inferenceSelection";

describe("agent settings (BYOK only)", () => {
  it("rejects workers_ai backend", () => {
    const parsed = InferenceBackendIdSchema.safeParse("workers_ai");
    expect(parsed.success).toBe(false);
  });

  it("parses empty settings", () => {
    const settings = parseAgentSettings({});
    expect(hasEnabledInferenceProvider(settings)).toBe(false);
    expect(settings.skills).toEqual([]);
  });

  it("enables when a provider instance is present", () => {
    const instance = buildInitialProviderInstance("openai", "OpenAI");
    const settings = mergeAgentSettings(undefined, {
      inference: {
        providerInstances: { [instance.id]: instance },
        default: {
          instanceId: instance.id,
          modelId: instance.enabledModelIds[0]!,
        },
      },
    });
    expect(hasEnabledInferenceProvider(settings)).toBe(true);
  });

  it("activates a saved user provider in a project without agent settings", () => {
    const settings = activateConfiguredAgentProviders(undefined, {
      openai: true,
    });
    const instances = Object.values(settings.inference.providerInstances);

    expect(settings.enabled).toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ backend: "openai", enabled: true });
    expect(settings.inference.default).toEqual({
      instanceId: instances[0]!.id,
      modelId: instances[0]!.defaultModelId,
    });
  });

  it("reactivates a configured provider without replacing project model choices", () => {
    const instance = {
      ...buildInitialProviderInstance("anthropic", "Claude for this site"),
      enabled: false,
      defaultModelId: "claude-project-model",
      enabledModelIds: ["claude-project-model"],
    };
    const settings = activateConfiguredAgentProviders(
      mergeAgentSettings(undefined, {
        inference: { providerInstances: { [instance.id]: instance } },
      }),
      { anthropic: true },
    );

    expect(settings.inference.providerInstances[instance.id]).toMatchObject({
      label: "Claude for this site",
      enabled: true,
      defaultModelId: "claude-project-model",
      enabledModelIds: ["claude-project-model"],
    });
    expect(settings.inference.default).toEqual({
      instanceId: instance.id,
      modelId: "claude-project-model",
    });
  });

  it("does not activate providers without a saved key", () => {
    const settings = activateConfiguredAgentProviders(undefined, {});
    expect(settings.inference.providerInstances).toEqual({});
    expect(settings.enabled).toBe(false);
  });
});

describe("inference selection", () => {
  it("requires configured credentials", () => {
    const instance = buildInitialProviderInstance("anthropic", "Anthropic");
    const settings = mergeAgentSettings(undefined, {
      inference: {
        providerInstances: { [instance.id]: instance },
        default: {
          instanceId: instance.id,
          modelId: instance.enabledModelIds[0]!,
        },
      },
    });

    expect(
      listReadyInferenceBackends({
        settings,
        configuredBackends: {},
      }),
    ).toEqual([]);

    const ready = listReadyInferenceBackends({
      settings,
      configuredBackends: { anthropic: true },
    });
    expect(ready).toEqual(["anthropic"]);

    const resolved = resolveRequestInference({
      settings,
      configuredBackends: { anthropic: true },
    });
    expect(resolved?.provider).toBe("anthropic");
  });

  it("lists only credential backends", () => {
    expect(
      (CREDENTIAL_BACKEND_IDS as readonly string[]).includes("workers_ai"),
    ).toBe(false);
  });

  it("lists recommended models for curated backends", () => {
    const recommended = listRecommendedModelIds({
      backendId: "openai",
      catalog: [
        { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
        { id: "gpt-4o", name: "GPT 4o" },
        { id: "other-model", name: "Other" },
      ],
    });
    expect(recommended).toContain("gpt-4.1-mini");
    expect(recommended).toContain("gpt-4o");
    expect(
      pickRecommendedDefaultModelId({
        backendId: "openai",
        recommendedModelIds: recommended,
      }),
    ).toBe(recommended[0]);
  });

  it("enables the full catalog by default and preserves explicit opt-outs", () => {
    expect(
      reconcileCatalogModelAvailability({
        backendId: "openai",
        catalogModelIds: ["gpt-4.1-mini", "gpt-4o", "new-model"],
        disabledModelIds: ["gpt-4o"],
        currentDefaultModelId: "gpt-4o",
      }),
    ).toEqual({
      enabledModelIds: ["gpt-4.1-mini", "new-model"],
      disabledModelIds: ["gpt-4o"],
      defaultModelId: "gpt-4.1-mini",
    });
  });

  it("migrates legacy provider instances to an empty opt-out list", () => {
    const instance = buildInitialProviderInstance("openai", "OpenAI");
    const { disabledModelIds: _disabled, ...legacy } = instance;
    const settings = parseAgentSettings({
      inference: { providerInstances: { [instance.id]: legacy } },
    });
    expect(settings.inference.providerInstances[instance.id]?.disabledModelIds).toEqual([]);
  });

  it("retains valid persisted providers when older or damaged settings are present", () => {
    const instance = buildInitialProviderInstance("openai", "OpenAI");
    const settings = parseAgentSettings({
      enabled: true,
      inference: {
        default: {
          instanceId: instance.id,
          modelId: instance.enabledModelIds[0],
        },
        providerInstances: {
          [instance.id]: {
            ...instance,
            obsoleteCatalogCache: ["legacy-model"],
          },
          damaged: { id: "not-a-uuid", backend: "openai" },
        },
        obsoleteSelection: "legacy-model",
      },
      obsoleteAgentField: true,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.inference.providerInstances[instance.id]).toMatchObject({
      id: instance.id,
      backend: "openai",
      label: "OpenAI",
    });
    expect(settings.inference.default).toEqual({
      instanceId: instance.id,
      modelId: instance.enabledModelIds[0],
    });
    expect(settings.inference.providerInstances.damaged).toBeUndefined();
  });

  it("drops an invalid persisted default without dropping its providers", () => {
    const instance = buildInitialProviderInstance("anthropic", "Anthropic");
    const settings = parseAgentSettings({
      inference: {
        default: { instanceId: instance.id, modelId: "removed-model" },
        providerInstances: { [instance.id]: instance },
      },
    });

    expect(settings.inference.providerInstances[instance.id]).toBeDefined();
    expect(settings.inference.default).toBeUndefined();
  });
});

describe("desktop tool allowlist", () => {
  it("allows existing-surface tools", () => {
    expect(isDesktopToolAllowed("aria_list_pages")).toBe(true);
    expect(isDesktopToolAllowed("aria_get_design_system")).toBe(true);
    expect(isDesktopToolAllowed("aria_list_redirects")).toBe(true);
  });

  it("includes registered CMS and renderer-plane tools", () => {
    expect(isDesktopToolAllowed("aria_create_entry")).toBe(true);
    expect(isDesktopToolAllowed("insert_nodes")).toBe(true);
    expect(isDesktopToolAllowed("aria_execute_command")).toBe(true);
    expect(isDesktopToolAllowed("aria_set_node_condition")).toBe(true);
  });

  it("excludes cloud-only tools", () => {
    expect(isDesktopToolAllowed("aria_get_site_traffic")).toBe(false);
  });
});

describe("renderer host registration compatibility", () => {
  it("accepts scoped positional registrations from a hot-reloaded renderer", () => {
    expect(
      parseAgentRendererHostRegistrationArgs(
        "/project/a",
        true,
        "document",
        "00000000-0000-4000-8000-000000000012",
      ),
    ).toMatchObject({
      kind: "scoped",
      registration: {
        projectPath: "/project/a",
        active: true,
        scope: "document",
      },
    });
  });

  it("accepts the former two-argument registration contract", () => {
    expect(
      parseAgentRendererHostRegistrationArgs("/project/a", true),
    ).toEqual({ kind: "legacy", projectPath: "/project/a", active: true });
  });
});
