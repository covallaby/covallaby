import { describe, expect, it } from "vitest";
import { REPO_TABS } from "../web/src/components/repo-tabs.js";
import { repoPageScope } from "../web/src/pages/Repo.js";

describe("repository page scope", () => {
  it("only presents the branch picker on pages it actually filters", () => {
    expect(repoPageScope("/r/acme/app/activity", "acme/app")).toEqual({
      branchScoped: true,
      label: null,
    });
    expect(repoPageScope("/r/acme/app/components", "acme/app").label).toBe("Repository-wide");
    expect(repoPageScope("/r/acme/app/pulls", "acme/app").label).toBe("Repository-wide");
    expect(repoPageScope("/r/acme/app/storybook-previews/12", "acme/app").label).toBe(
      "Recorded evidence",
    );
    expect(repoPageScope("/r/acme/app/pr/42", "acme/app").label).toBe("Pull request");
  });

  it("gives component previews their own repository-wide tab", () => {
    expect(REPO_TABS.find((tab) => tab.to === "components")).toMatchObject({
      label: "Components",
      match: ["storybook-previews"],
      scope: "repo",
    });
  });
});
