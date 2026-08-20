import { describe, expect, it } from "vitest";
import { electronNodeEnv } from "./processLaunch";

describe("embedded Electron Node launcher", () => {
  it("forces Electron into Node mode without changing the caller environment", () => {
    const base = { PATH: "/project/bin", ELECTRON_RUN_AS_NODE: "0" };
    const env = electronNodeEnv(base);
    expect(env).toEqual({ PATH: "/project/bin", ELECTRON_RUN_AS_NODE: "1" });
    expect(base.ELECTRON_RUN_AS_NODE).toBe("0");
  });
});
