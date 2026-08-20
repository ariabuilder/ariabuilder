export type AppMenuCommand =
  | { type: "new-project" }
  | { type: "open-project" }
  | { type: "close-context" }
  | { type: "open-recent"; projectPath: string };
