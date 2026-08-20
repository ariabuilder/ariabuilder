export {
  ANALYTICS_PROVIDER_IDS,
  ANALYTICS_PROVIDERS,
  ANALYTICS_PROVIDER_MAP,
  type AnalyticsFieldType,
  type AnalyticsProviderCspRequirements,
  type AnalyticsProviderDefinition,
  type AnalyticsProviderField,
  type AnalyticsProviderId,
  type CompiledProviderScripts,
} from "./providers";

export {
  compileAnalyticsScripts,
  type CompiledAnalyticsCspRequirements,
  type CompiledAnalyticsScripts,
} from "./compileAnalyticsScripts";

export {
  classifyInjectionHtml,
  providerPrimaryValue,
  substituteInjectionFields,
  type ClassifiedInjection,
} from "./fingerprints";

export {
  isSourceExpression,
  resolveSourceFields,
  unwrapSourceExpression,
  type SourceFieldOrigin,
} from "./sourceExpressions";
