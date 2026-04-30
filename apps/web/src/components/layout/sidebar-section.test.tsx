import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageCircle } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarSection } from "./sidebar-section.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SidebarSection", () => {
  it("expands and collapses from the keyboard-accessible section button", async () => {
    const user = userEvent.setup();
    render(
      <SidebarSection id="recent-chats" title="Recent Chats" icon={MessageCircle} defaultOpen>
        <button type="button">Continue Frank Hub build</button>
      </SidebarSection>
    );

    const trigger = screen.getByRole("button", { name: "Recent Chats" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Continue Frank Hub build" })).toBeTruthy();

    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Continue Frank Hub build" })).toBeNull();
  });
});
