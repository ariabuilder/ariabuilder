import { conditionOperatorsForType } from "./operators";
import type {
  ConditionExecutionPlane,
  ConditionSourceOption,
  ConditionValueType,
} from "./types";

export type ConditionProviderDefinition = {
  id: string;
  label: string;
  group: ConditionSourceOption["group"];
  execution: ConditionExecutionPlane;
  description: string;
};

export const CONDITION_PROVIDERS: ConditionProviderDefinition[] = [
  { id: "component", label: "Component property", group: "Component", execution: "build", description: "A property passed to this component." },
  { id: "cms", label: "CMS content", group: "Content", execution: "build", description: "Content from the current CMS entry or loop item." },
  { id: "project", label: "Project data", group: "Content", execution: "build", description: "Statically inspected data owned by this project." },
  { id: "page", label: "Page data", group: "Page", execution: "build", description: "A value defined in this Astro document." },
  { id: "locale", label: "Locale", group: "Page", execution: "request", description: "The active content locale." },
  { id: "route", label: "Route", group: "Page", execution: "request", description: "The current path, query, or route parameter." },
  { id: "site", label: "Site", group: "Site", execution: "build", description: "The configured site URL and project context." },
  { id: "time", label: "Date and time", group: "Site", execution: "request", description: "The current date in the site context." },
  { id: "request", label: "Request", group: "Visitor", execution: "request", description: "Request data available during server rendering." },
  { id: "visitor", label: "Visitor", group: "Visitor", execution: "request", description: "Authenticated visitor data supplied by the project." },
  { id: "browser", label: "Browser", group: "Browser", execution: "client", description: "Presentation-only state available in the browser." },
];

export function conditionProvider(id: string): ConditionProviderDefinition | null {
  return CONDITION_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function createConditionSourceOption(input: {
  provider: string;
  path?: string[];
  label: string;
  valueType?: ConditionValueType;
  options?: ConditionSourceOption["options"];
  description?: string;
}): ConditionSourceOption {
  const provider = conditionProvider(input.provider);
  return {
    source: { provider: input.provider, path: input.path ?? [] },
    label: input.label,
    group: provider?.group ?? "Content",
    valueType: input.valueType ?? "unknown",
    execution: provider?.execution ?? "editor",
    options: input.options,
    description: input.description ?? provider?.description,
  };
}

export function operatorsForConditionSource(source: ConditionSourceOption) {
  return conditionOperatorsForType(source.valueType);
}

