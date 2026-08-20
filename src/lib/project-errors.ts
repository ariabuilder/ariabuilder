import { m } from "@/paraglide/messages.js";

export function translateProjectError(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "not_astro_project":
      return m.project_error_not_astro();
    case "folder_not_empty":
      return m.project_error_folder_not_empty();
    default:
      return code;
  }
}
