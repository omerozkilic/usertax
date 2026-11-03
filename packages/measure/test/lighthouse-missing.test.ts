import { describe, expect, it, vi } from 'vitest';

vi.mock('lighthouse', () => {
  throw new Error('Cannot find package lighthouse');
});

const { runLighthouse } = await import('@usertax/measure');

describe('runLighthouse without the optional packages', () => {
  it('explains how to install them', async () => {
    await expect(runLighthouse({ urls: ['http://127.0.0.1:1/'], runs: 1 })).rejects.toThrow(
      /npm install -D lighthouse chrome-launcher/,
    );
  });
});
