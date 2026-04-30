import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, type ComposerMode, type ComposerModel } from "./chat-composer.js";

const models: ComposerModel[] = [{ id: "default", label: "Default model" }];
const modes: ComposerMode[] = [{ id: "chat", label: "Chat" }];

function renderComposer(overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const onSubmit = vi.fn<React.ComponentProps<typeof ChatComposer>["onSubmit"]>().mockResolvedValue(undefined);
  const result = render(
    <ChatComposer
      models={models}
      modes={modes}
      selectedModelId="default"
      selectedMode="chat"
      onModelChange={vi.fn()}
      onModeChange={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />
  );
  return { ...result, onSubmit };
}

afterEach(() => cleanup());

describe("ChatComposer", () => {
  it("renders a clean composer with secondary controls inside one menu", async () => {
    const user = userEvent.setup();
    renderComposer();

    expect(screen.getByLabelText("Message")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask for anything...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open composer menu" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start voice input" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand composer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open composer menu" }));

    expect(screen.getByRole("menu", { name: "Composer menu" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Attach file" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Attach folder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Attach image" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Chat" })).toBeTruthy();
  });

  it("keeps send disabled when the message is empty", () => {
    renderComposer();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(true);
  });

  it("submits with Enter", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();

    await user.type(screen.getByLabelText("Message"), "Draft the strategy brief");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Draft the strategy brief",
        selectedModelId: "default",
        selectedMode: "chat"
      })
    );
  });

  it("keeps a newline with Shift+Enter", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Message");

    await user.type(textarea, "Line one{shift>}{enter}{/shift}Line two");

    expect(textarea.value).toBe("Line one\nLine two");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("opens fullscreen composer and closes it with Escape", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Expand composer" }));
    expect(screen.getByRole("dialog", { name: "Expanded composer" })).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Expanded composer" })).toBeNull());
  });
});
