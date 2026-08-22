import { describe, expect, it } from "vitest";
import { quoteAstroExecutableForShell } from "./runner";

describe("Astro utility runner", () => {
  it("quotes the Windows cmd shim when the project path contains spaces", () => {
    const executable = "C:\\Users\\First Last\\site\\node_modules\\.bin\\astro.cmd";
    expect(quoteAstroExecutableForShell(executable, "win32"))
      .toBe(`"${executable}"`);
  });

  it("leaves POSIX executables unchanged", () => {
    const executable = "/Users/first last/site/node_modules/.bin/astro";
    expect(quoteAstroExecutableForShell(executable, "darwin")).toBe(executable);
  });
});
