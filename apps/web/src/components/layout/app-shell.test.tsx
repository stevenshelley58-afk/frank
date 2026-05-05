import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Folder, Home, Settings } from "lucide-react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell, type AppShellPage } from "./app-shell.js";

vi.mock("../../api.js", () => ({
  listTasks: vi.fn(async () => [])
}));

vi.mock("../status/status-pill.js", () => ({
  StatusPill: ({ onNavigateOps }: { onNavigateOps: () => void }) => (
    <button type="button" onClick={onNavigateOps}>
      All systems operational
    </button>
  )
}));

const pages: AppShellPage[] = [
  {
    id: "home",
    label: "Home",
    title: "Home",
    description: "Home",
    icon: Home
  },
  {
    id: "projects",
    label: "Projects",
    title: "Projects",
    description: "Projects",
    icon: Folder
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    description: "Settings",
    icon: Settings,
    placement: "settings"
  }
];

function renderShell(overrides: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  const onNavigate = vi.fn();
  const result = render(
    <AppShell
      pages={pages}
      activePageId="home"
      onNavigate={onNavigate}
      {...overrides}
    >
      <div>Home content</div>
    </AppShell>
  );
  return { ...result, onNavigate };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AppShell", () => {
  it("does not show mock chat history or schedule sections in the sidebar", () => {
    renderShell();

    expect(screen.queryByText("Recent Chats")).toBeNull();
    expect(screen.queryByText("Continue Frank Hub build")).toBeNull();
    expect(screen.queryByText("Upcoming")).toBeNull();
  });

  it("opens mobile navigation as a dialog and closes it after navigation", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Projects" }).at(-1)!);

    expect(onNavigate).toHaveBeenCalledWith("projects");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  });
});
