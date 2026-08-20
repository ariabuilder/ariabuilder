import { afterEach, describe, expect, it } from "vitest";
import { packageManagerEnv, projectProcessEnv } from "./toolEnv";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

describe("restricted project environments", () => {
  it("forwards proxy and certificate settings case-insensitively without TLS bypasses", () => {
    process.env.https_proxy = "http://proxy.test:8080";
    process.env.Node_Extra_CA_Certs = "/tmp/project-ca.pem";
    process.env.GIT_SSL_CAINFO = "/tmp/git-ca.pem";
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    process.env.ARIA_UNRESTRICTED_SECRET = "must-not-leak";

    for (const env of [projectProcessEnv(), packageManagerEnv()]) {
      expect(env.https_proxy).toBe("http://proxy.test:8080");
      expect(env.Node_Extra_CA_Certs).toBe("/tmp/project-ca.pem");
      expect(env.GIT_SSL_CAINFO).toBe("/tmp/git-ca.pem");
      expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      expect(env.ARIA_UNRESTRICTED_SECRET).toBeUndefined();
    }
  });
});
