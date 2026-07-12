import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import "../web/src/styles.css";

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as "light" | "dark";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="min-h-screen bg-(--page) p-6 text-(--ink)">
      <div
        className={`mx-auto ${context.parameters.contentWidth === "wide" ? "max-w-7xl" : "max-w-4xl"}`}
      >
        <Story />
      </div>
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Dashboard color theme",
      defaultValue: "light",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    a11y: { test: "error" },
    options: { storySort: { order: ["Dashboard", "Design system"] } },
  },
};

export default preview;
