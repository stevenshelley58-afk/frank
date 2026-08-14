import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_PROVIDER_IDS, ModelSelectionError, modelMismatch, resolveHarness, setRoomRoute } from './providers';

afterEach(() => {
  setRoomRoute('central', 'auto');
});

describe('explicit model selection', () => {
  it('keeps Auto Goose-first with Letta as the fallback', () => {
    expect(AUTO_PROVIDER_IDS).toEqual(['goose', 'letta']);
  });

  it('rejects unknown models instead of silently falling back', async () => {
    await expect(resolveHarness('central', 'not-a-model')).rejects.toMatchObject({
      name: 'ModelSelectionError',
      code: 'unsupported_model',
    } satisfies Partial<ModelSelectionError>);
  });

  it('compares model basenames across provider spellings', () => {
    expect(modelMismatch('deepseek-reasoner', 'deepseek-reasoner')).toBe(false);
    expect(modelMismatch('deepseek-chat', 'deepseek-reasoner')).toBe(true);
    // Letta reports 'deepseek/deepseek-chat', Goose reports 'deepseek-chat' — same model.
    expect(modelMismatch('deepseek/deepseek-chat', 'deepseek-chat')).toBe(false);
  });

  it('fails closed when a named room route is unhealthy', async () => {
    // Letta is unavailable without a server — pinned routes throw, don't silently fall back.
    setRoomRoute('central', 'letta');
    await expect(resolveHarness('central')).rejects.toMatchObject({
      name: 'ModelSelectionError',
      code: 'model_unavailable',
    } satisfies Partial<ModelSelectionError>);
  });
});
