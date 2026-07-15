import type { ReactElement } from "react";
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RedirectToActivity, buildRoutes, crumbTrail, orgFromPathname } from "../web/src/App.js";
import { CompareBranches, PullRequest } from "../web/src/pages/Compare.js";
import { Components } from "../web/src/pages/Components.js";
import { Home } from "../web/src/pages/Home.js";
import { PlaybackDetail } from "../web/src/pages/Playbacks.js";
import { RepoLayout } from "../web/src/pages/Repo.js";
import { Activity } from "../web/src/pages/RepoActivity.js";
import { StorybookPreviewDetail } from "../web/src/pages/StorybookPreviews.js";
import { Upload } from "../web/src/pages/Upload.js";

const routes = buildRoutes(null);

/** The component types along the matched route chain (undefined for pathless/element-less routes). */
function matchedTypes(pathname: string): (ReactElement["type"] | undefined)[] {
  const matches = matchRoutes(routes, pathname);
  expect(matches, `expected a route match for ${pathname}`).not.toBeNull();
  return (matches ?? []).map((m) => (m.route.element as ReactElement | undefined)?.type);
}

describe("repo leaf routes render inside RepoLayout", () => {
  const leaves: [string, ReactElement["type"]][] = [
    ["/r/acme/app/pr/12", PullRequest],
    ["/r/acme/app/compare", CompareBranches],
    ["/r/acme/app/activity", Activity],
    ["/r/acme/app/components", Components],
    ["/r/acme/app/u/34", Upload],
    ["/r/acme/app/test-runs/56", PlaybackDetail],
    ["/r/acme/app/storybook-previews/78", StorybookPreviewDetail],
  ];

  for (const [path, component] of leaves) {
    it(`${path} is a child of the repo shell`, () => {
      const types = matchedTypes(path);
      expect(types[0]).toBe(RepoLayout);
      expect(types.at(-1)).toBe(component);
    });
  }
});

describe("legacy evidence-list routes redirect into the Activity tab", () => {
  const legacy = ["/r/acme/app/uploads", "/r/acme/app/playbacks"] as const;

  for (const path of legacy) {
    it(`${path} deep link stays alive as a redirect`, () => {
      const types = matchedTypes(path);
      expect(types[0]).toBe(RepoLayout);
      expect(types.at(-1)).toBe(RedirectToActivity);
    });
  }

  it("keeps the capture detail route out of the redirect", () => {
    expect(matchedTypes("/r/acme/app/storybook-previews/78").at(-1)).toBe(StorybookPreviewDetail);
  });

  it("gives the legacy component index a first-class destination", () => {
    expect(matchedTypes("/r/acme/app/storybook-previews").at(-1)).toBe(Components);
  });
});

describe("org routes", () => {
  it("serves the org overview at /o/:owner", () => {
    const types = matchedTypes("/o/acme");
    expect(types.at(-1)).toBe(Home);
  });

  it("still matches the all-orgs overview at /", () => {
    const matches = matchRoutes(routes, "/");
    expect(matches).not.toBeNull();
    expect(matches?.[0]?.route.element).toBeTruthy();
  });

  it("derives the current org from org and repo paths", () => {
    expect(orgFromPathname("/o/acme")).toBe("acme");
    expect(orgFromPathname("/r/acme/app/pr/12")).toBe("acme");
    expect(orgFromPathname("/")).toBeNull();
  });
});

describe("crumbTrail", () => {
  it("is just Overview at the root", () => {
    expect(crumbTrail("/")).toEqual([{ label: "Overview", to: "/" }]);
  });

  it("adds the org tier on /o/:owner", () => {
    expect(crumbTrail("/o/acme")).toEqual([{ label: "Overview", to: "/" }, { label: "acme" }]);
  });

  it("links Overview / org / repo on a repo page", () => {
    expect(crumbTrail("/r/acme/app")).toEqual([
      { label: "Overview", to: "/" },
      { label: "acme", to: "/o/acme" },
      { label: "app", to: "/r/acme/app", mono: true },
    ]);
  });

  it("keeps the section and entity tail labels", () => {
    const tail = (rest: string) => crumbTrail(`/r/acme/app/${rest}`).at(-1)?.label;
    expect(tail("insights")).toBe("Insights");
    expect(tail("activity")).toBe("Activity");
    expect(tail("pulls")).toBe("Pull requests");
    expect(tail("policy")).toBe("Policy");
    expect(tail("compare")).toBe("Compare");
    expect(tail("storybook-previews/4")).toBe("Component capture run 4");
    expect(tail("test-runs/9")).toBe("Playwright run 9");
    expect(tail("u/34")).toBe("upload 34");
    expect(tail("pr/12")).toBe("PR #12");
  });

  it("decodes encoded owners and links the encoded path", () => {
    expect(crumbTrail("/r/acme%20co/app")[1]).toEqual({
      label: "acme co",
      to: "/o/acme%20co",
    });
  });
});
