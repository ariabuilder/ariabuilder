export type GlobalSearchResult =
  | {
      kind: "page";
      id: string;
      label: string;
      detail: string;
      route: string;
      file: string;
    }
  | {
      kind: "component" | "layout";
      id: string;
      label: string;
      detail: string;
      file: string;
    }
  | {
      kind: "collection";
      id: string;
      label: string;
      detail: string;
      collectionName: string;
    }
  | {
      kind: "entry";
      id: string;
      label: string;
      detail: string;
      collectionName: string;
      entryId: string;
      locale?: string;
    }
  | {
      kind: "media";
      id: string;
      label: string;
      detail: string;
      assetId: string;
    }
  | {
      kind: "destination";
      id: string;
      label: string;
      detail: string;
      rail: "design" | "settings";
      settingsTab?: "history";
    }
  | {
      kind: "command";
      id: string;
      label: string;
      detail: string;
      command: "undo" | "redo" | "start-preview";
    };

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchResult[];
  truncated: boolean;
};
