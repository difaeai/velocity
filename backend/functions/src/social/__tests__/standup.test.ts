/**
 * The standup reads our own page. The page read is computed every morning to
 * say what our audience actually did; until 2026-10-31 it was handed to the
 * standup and never put in the prompt, so the desk planned without it.
 */
import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ prompt: '' }));
vi.mock('../engine', async (orig) => ({
  ...(await orig<typeof import('../engine')>()),
  modelReady: () => true,
  generateJson: async (req: { prompt: string }) => {
    sent.prompt = req.prompt;
    return { data: { concept: 'a driver counts out the day on his bonnet' }, sources: [] };
  },
}));

import { planContent } from '../crew';
import { DEFAULT_SETTINGS } from '../types';

describe('the standup', () => {
  it('puts our own page read in front of the room', async () => {
    await planContent({
      settings: DEFAULT_SETTINGS,
      team: [],
      format: 'post',
      angle: 'fares',
      facts: {},
      research: null,
      recentConcepts: [],
      feedback: [],
      pageRead: 'OUR OWN PAGE, from the last 39 posts (median reach 127).',
    });
    expect(sent.prompt).toContain('OUR OWN PAGE, from the last 39 posts');
  });
});
