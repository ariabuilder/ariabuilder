export function composerPageNavigationIdentity(input: {
  projectPath: string
  selectedRoute: string | null
  selectedPageFile: string | null
}): string {
  return JSON.stringify([
    input.projectPath,
    input.selectedRoute,
    input.selectedPageFile,
  ])
}
