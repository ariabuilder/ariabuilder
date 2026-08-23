import { describe, expect, it } from "vitest";
import {
  checkoutBranch,
  createBranch,
  normalizeBranchName,
} from "./git";

describe("Git branch input", () => {
  it("normalizes ordinary branch names", () => {
    expect(normalizeBranchName("  feature/composer  ")).toBe("feature/composer");
  });

  it("rejects empty and option-shaped branch names", async () => {
    expect(() => normalizeBranchName("   ")).toThrow("Branch name is required");
    for (const branch of ["-", "--orphan", "--detach"]) {
      expect(() => normalizeBranchName(branch)).toThrow(
        'Branch names cannot start with "-"',
      );
      await expect(checkoutBranch("/not-a-repository", branch)).rejects.toThrow(
        'Branch names cannot start with "-"',
      );
      await expect(createBranch("/not-a-repository", branch)).rejects.toThrow(
        'Branch names cannot start with "-"',
      );
    }
  });
});
