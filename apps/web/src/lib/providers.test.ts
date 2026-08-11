import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_PROVIDER_IDS, ModelSelectionError, modelMismatch, resolveHarness, setRoomRoute } from './providers';

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
  setRoomRoute('central', 'auto');
});

describe('explicit model selection', () => {
  it('keeps Auto Goose-first with DeepSeek as the fallback', () => {
    expect(AUTO_PROVIDER_IDS).toEqual(['goose', 'deepseek', 'letta']);
  });

  it('forces the DeepSeek provider without changing the room route', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-only';
    const resolved = await resolveHarness('central', 'deepseek-reasoner');
    expect(resolved.provider.id).toBe('deepseek');
  });

  it('rejects unknown models instead of silently falling back', async () => {
    await expect(resolveHarness('central', 'not-a-model')).rejects.toMatchObject({
      name: 'ModelSelectionError',
      code: 'unsupported_model',
    } satisfies Partial<ModelSelectionError>);
  });

  it('compares an explicit selection rather than the deployment default', () => {
    expect(modelMismatch('deepseek-reasoner', 'deepseek-reasoner')).toBe(false);
    expect(modelMismatch('deepseek-chat', 'deepseek-reasoner')).toBe(true);
  });

  it('fails closed when a named room route is unhealthy', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    setRoomRoute('central', 'deepseek');
    await expect(resolveHarness('central')).rejects.toMatchObject({
      name: 'ModelSelectionError',
      code: 'model_unavailable',
    } satisfies Partial<ModelSelectionError>);
  });
});
