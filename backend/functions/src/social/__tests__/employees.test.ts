/**
 * The rota.
 *
 * Two properties decide whether "hire someone and they start working" is true
 * or a figure of speech: the right person has to be picked for a stage, and two
 * people in the same job have to actually share it rather than one of them
 * doing everything. Both are pure functions, and both are the sort of thing
 * that breaks silently — a stage quietly run by the wrong person still produces
 * output, it is just worse.
 */
import { describe, it, expect } from 'vitest';

import { assign, coverageGaps } from '../employees';
import { ROLE_SPECS, ROLES, STAGES, STAGE_COVER, type Employee, type Role } from '../types';

let seq = 0;
function hire(role: Role, over: Partial<Employee> = {}): Employee {
  seq += 1;
  return {
    id: `e${seq}`,
    name: `${role}-${seq}`,
    role,
    title: ROLE_SPECS[role].titles[0],
    status: 'active',
    instructions: '',
    colour: '#ccff00',
    hiredAtMs: 1_000 + seq,
    hiredBy: null,
    lastWorkedAtMs: null,
    piecesWorked: 0,
    ...over,
  };
}

describe('who picks up a job', () => {
  it('gives every stage to the role that owns it', () => {
    const team = ROLES.map((role) => hire(role));
    for (const stage of STAGES) {
      const picked = assign(team, stage);
      expect(picked).not.toBeNull();
      expect(picked!.employee.role).toBe(STAGE_COVER[stage].primary);
      expect(picked!.covering).toBe(false);
    }
  });

  it('falls back to whoever covers, and says that is what happened', () => {
    // A writer alone still gets the market read and the distribution done,
    // because that is what one person on a small team actually does.
    const team = [hire('content-writer')];
    const research = assign(team, 'research');
    expect(research?.employee.role).toBe('content-writer');
    expect(research?.covering).toBe(true);

    const distribute = assign(team, 'distribute');
    expect(distribute?.employee.role).toBe('content-writer');
    expect(distribute?.covering).toBe(true);
  });

  it('returns nobody when a stage has no owner and no cover', () => {
    const team = [hire('content-writer')];
    expect(assign(team, 'design')).toBeNull();
    expect(assign(team, 'video')).toBeNull();
    expect(assign(team, 'ads')).toBeNull();
  });

  it('returns nobody for an empty office', () => {
    for (const stage of STAGES) expect(assign([], stage)).toBeNull();
  });

  it('shares the work between two people in the same job', () => {
    const first = hire('designer', { lastWorkedAtMs: 5_000 });
    const second = hire('designer', { lastWorkedAtMs: 1_000 });
    // Whoever worked least recently is next up — the only fair rule that needs
    // no manager.
    expect(assign([first, second], 'design')?.employee.id).toBe(second.id);
    expect(assign([second, first], 'design')?.employee.id).toBe(second.id);
  });

  it('starts someone who has never worked before anyone who has', () => {
    const veteran = hire('designer', { lastWorkedAtMs: 9_000 });
    const newcomer = hire('designer');
    expect(assign([veteran, newcomer], 'design')?.employee.id).toBe(newcomer.id);
  });

  it('breaks a tie by who has been here longest', () => {
    const senior = hire('content-writer', { hiredAtMs: 100, lastWorkedAtMs: 2_000 });
    const junior = hire('content-writer', { hiredAtMs: 900, lastWorkedAtMs: 2_000 });
    expect(assign([junior, senior], 'script')?.employee.id).toBe(senior.id);
  });

  it('prefers the owner over a stand-in even when the stand-in is idler', () => {
    const researcher = hire('research-assistant', { lastWorkedAtMs: 9_000 });
    const writer = hire('content-writer', { lastWorkedAtMs: 1 });
    expect(assign([writer, researcher], 'research')?.employee.role).toBe('research-assistant');
  });
});

describe('what a team cannot do', () => {
  it('says the office is unstaffed in plain words', () => {
    const gaps = coverageGaps([]);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]).toContain('content writer');
  });

  it('has nothing to report about a fully staffed team', () => {
    expect(coverageGaps(ROLES.map((role) => hire(role)))).toEqual([]);
  });

  it('counts either search specialist as covering search', () => {
    // Matched on the whole phrase: the word "search" also lives inside
    // "research", and the research gap is a different complaint.
    const gap = 'Nobody on search';
    expect(coverageGaps([hire('content-writer')]).some((g) => g.startsWith(gap))).toBe(true);
    expect(
      coverageGaps([hire('content-writer'), hire('google-seo-expert')]).some((g) => g.startsWith(gap)),
    ).toBe(false);
    expect(
      coverageGaps([hire('content-writer'), hire('seo-expert')]).some((g) => g.startsWith(gap)),
    ).toBe(false);
  });

  it('does not complain about a job that is filled', () => {
    const gaps = coverageGaps([hire('content-writer'), hire('designer')]);
    expect(gaps.some((g) => g.includes('content writer'))).toBe(false);
    expect(gaps.some((g) => g.includes('No designer'))).toBe(false);
    expect(gaps.some((g) => g.includes('video editor'))).toBe(true);
  });
});
