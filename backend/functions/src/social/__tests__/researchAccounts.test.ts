/**
 * The competitors' real numbers need no web search, so a morning whose search
 * fails (the free model cannot search at all) still reads them — and still
 * hands them to the standup. Before 2026-10-28 a failed search dropped them.
 */
import { describe, expect, it, vi } from 'vitest';

const { readAccounts } = vi.hoisted(() => ({
  readAccounts: vi.fn(async (handles: string[]) =>
    handles.map((username) => ({
      username,
      followers: 1000,
      medianEngagement: 10,
      top: [{ caption: 'a joke', mediaType: 'IMAGE', permalink: null, likes: 90, comments: 10, multiple: 10 }],
    })),
  ),
}));
vi.mock('../discovery', async (load) => ({ ...(await load<typeof import('../discovery')>()), readAccounts }));
vi.mock('../engine', async (load) => ({
  ...(await load<typeof import('../engine')>()),
  modelReady: () => true,
  generateJson: async () => {
    throw new Error('The free engine cannot search the web, so there is no market read today.');
  },
}));
vi.mock('../workspace', async (load) => ({
  ...(await load<typeof import('../workspace')>()),
  isHouse: () => true,
  sdb: { doc: () => ({ get: async () => ({ exists: false }), set: async () => undefined }) },
}));

import { researchBlock } from '../crew';
import { HOUSE_STUDY } from '../discovery';
import { runResearch } from '../research';
import { DEFAULT_SETTINGS, type Employee } from '../types';

const hina: Employee = {
  id: 'r1',
  name: 'Hina',
  role: 'research-assistant',
  title: 'research-assistant',
  status: 'active',
  instructions: '',
  colour: '#ccff00',
  hiredAtMs: 0,
  hiredBy: null,
  lastWorkedAtMs: null,
  piecesWorked: 0,
};

describe('a morning whose search failed', () => {
  it('still reads the competitors and the study list, and the standup still sees them', async () => {
    const research = await runResearch({ settings: DEFAULT_SETTINGS, date: '2026-10-29', employee: hina });

    expect(research.error).toMatch(/cannot search/);
    const read = readAccounts.mock.calls[0][0];
    expect(read).toEqual(expect.arrayContaining(['careempak', 'indrive.pk', 'yango.pakistan', ...HOUSE_STUDY]));
    expect(research.accounts?.map((a) => a.username)).toContain('indrive.pk');
    expect(researchBlock(research)).toMatch(/@indrive\.pk .*10x their normal/s);
  });
});
