/**
 * The planning half of the renderer, tested without ffmpeg anywhere near it.
 *
 * CI has no ffmpeg and should not need one: what can actually be wrong here is
 * the arithmetic — a hook that eats half the reel, a line that overflows the
 * frame, text drawn under Instagram's own interface, a last beat that ends
 * before the video does. All of that is a function of its arguments, so all of
 * it is checked here.
 */
import { describe, expect, it } from 'vitest';

import { escapeArg, filterGraph, planReel, wrap } from '../reel';
import type { PostScript } from '../types';

const script = (over: Partial<PostScript> = {}): PostScript => ({
  hook: 'That Lahore ride should have cost you 320 rupees.',
  hookVariants: [],
  frames: [
    { scene: 'a driver counting cash', overlay: 'You name the fare' },
    { scene: 'three bids arriving', overlay: 'Drivers bid on it' },
    { scene: 'the ride starting', overlay: 'No surge. Ever.' },
  ],
  voiceover: 'You name the fare. Drivers bid on it. No surge, ever.',
  cta: 'Download Velocity Rides',
  rationale: '',
  viralHook: '',
  ...over,
});

describe('wrap', () => {
  it('never splits a word', () => {
    for (const line of wrap('internationalisation is long', 8)) {
      expect(line).not.toMatch(/^\s|\s$/);
    }
    expect(wrap('internationalisation is long', 8)).toContain('internationalisation');
  });

  it('fills each line before starting the next', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('has nothing to say about nothing', () => {
    expect(wrap('   ', 20)).toEqual([]);
  });
});

describe('planReel', () => {
  it('gives the hook its three seconds and no more', () => {
    const plan = planReel({ script: script(), format: 'reel' });
    const hook = plan.beats[0];
    expect(hook.kind).toBe('hook');
    expect(hook.start).toBe(0);
    expect(hook.end).toBeGreaterThanOrEqual(2.5);
    expect(hook.end).toBeLessThanOrEqual(4);
  });

  it('does not let a long hook eat the reel', () => {
    const plan = planReel({
      script: script({
        hook: 'This is a deliberately long opening line with a great many words in it indeed',
      }),
      format: 'reel',
    });
    expect(plan.beats[0].end).toBeLessThanOrEqual(4);
  });

  it('fills the whole running time, with no gaps', () => {
    const plan = planReel({ script: script(), format: 'reel' });
    expect(plan.beats[0].start).toBe(0);
    expect(plan.beats[plan.beats.length - 1].end).toBe(plan.seconds);
    for (let i = 1; i < plan.beats.length; i++) {
      expect(plan.beats[i].start).toBeCloseTo(plan.beats[i - 1].end, 3);
    }
  });

  it('gives every beat long enough to be read', () => {
    const plan = planReel({ script: script(), format: 'reel' });
    for (const beat of plan.beats) expect(beat.end - beat.start).toBeGreaterThan(0.8);
  });

  it('shows the hook, every frame and the call to action', () => {
    const plan = planReel({ script: script(), format: 'reel' });
    expect(plan.beats.map((b) => b.kind)).toEqual(['hook', 'body', 'body', 'body', 'cta']);
  });

  it('wraps within the frame rather than running off it', () => {
    const plan = planReel({ script: script(), format: 'reel' });
    for (const beat of plan.beats) {
      for (const line of beat.lines) {
        // The same width estimate the layout uses, against the usable width.
        expect(line.length * beat.size * 0.56).toBeLessThanOrEqual(1080 - 90 * 2);
      }
      expect(beat.lines.length).toBeLessThanOrEqual(5);
    }
  });

  it('shrinks the type rather than clipping a long line', () => {
    const long = planReel({
      script: script({ hook: 'Pakistan deserves a ride-hailing app that does not punish you for rain' }),
      format: 'reel',
    });
    const short = planReel({ script: script({ hook: 'No surge.' }), format: 'reel' });
    expect(long.beats[0].size).toBeLessThan(short.beats[0].size);
  });

  it('is landscape for a video and vertical for a reel', () => {
    expect(planReel({ script: script(), format: 'reel' }).size).toEqual({ width: 1080, height: 1920 });
    expect(planReel({ script: script(), format: 'video' }).size).toEqual({ width: 1920, height: 1080 });
  });

  it('copes with a script that is only a hook', () => {
    const plan = planReel({
      script: script({ frames: [], cta: '' }),
      format: 'reel',
    });
    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0].end).toBe(plan.seconds);
  });
});

describe('filterGraph', () => {
  const paths = {
    textFiles: [] as string[][],
    displayFont: '/fonts/Outfit-Black.ttf',
    bodyFont: '/fonts/WorkSans-SemiBold.ttf',
  };

  const graphFor = (format: 'reel' | 'video' = 'reel') => {
    const plan = planReel({ script: script(), format });
    return filterGraph(plan, {
      ...paths,
      textFiles: plan.beats.map((b) => b.lines.map((_, i) => `/tmp/${i}.txt`)),
    });
  };

  it('draws nothing under Instagram’s own interface', () => {
    const graph = graphFor();
    // Every literal y the graph draws text at, including the base of a rise.
    for (const [, y] of graph.matchAll(/y='(\d+)\+34\*/g)) {
      expect(Number(y)).toBeGreaterThanOrEqual(240);
      expect(Number(y)).toBeLessThan(1470);
    }
    expect(graph).toContain('x=90');
  });

  it('ends on a single labelled output', () => {
    const graph = graphFor();
    expect(graph.endsWith('[out]')).toBe(true);
    expect(graph.match(/\[out\]/g)).toHaveLength(1);
  });

  it('chains every step to the one before it', () => {
    const graph = graphFor();
    // Nothing may read from a label that was never written.
    const written = new Set<string>();
    for (const step of graph.split(';')) {
      for (const [, label] of step.matchAll(/\[(\w+)\]/g)) {
        const isOutput = step.lastIndexOf(`[${label}]`) > step.lastIndexOf('=');
        if (isOutput) written.add(label);
      }
    }
    expect(written.has('out')).toBe(true);
  });

  it('reads the words from files rather than putting them in the graph', () => {
    const graph = graphFor();
    expect(graph).toContain('textfile=');
    expect(graph).not.toContain('320 rupees');
  });

  it('uses the time-aware overlay for the moving parts', () => {
    const graph = graphFor();
    // drawbox freezes an expression at frame one, so anything that has to move
    // must be an overlay. A regression here renders a bar that never moves.
    expect(graph).toMatch(/overlay=x='-1080\+1080\*t\//);
    expect(graph).not.toMatch(/drawbox=[^;]*w='[^']*t[^']*'/);
  });

  it('puts a scrim over attached slides so white text survives daylight', () => {
    const plan = planReel({ script: script(), format: 'reel', images: ['/a.png', '/b.png'] });
    const graph = filterGraph(plan, {
      ...paths,
      textFiles: plan.beats.map((b) => b.lines.map((_, i) => `/tmp/${i}.txt`)),
    });
    expect(graph).toContain('zoompan');
    expect(graph).toContain('concat=n=2');
    expect(graph).toMatch(/drawbox=[^;]*color=0x1a1c1c@0\.52/);
  });
});

describe('escapeArg', () => {
  it('escapes a Windows path so ffmpeg does not read the drive as an option', () => {
    expect(escapeArg('C:\\fonts\\Outfit.ttf')).toBe('C\\:/fonts/Outfit.ttf');
  });

  it('leaves a posix path alone apart from quoting', () => {
    expect(escapeArg('/srv/fonts/Outfit.ttf')).toBe('/srv/fonts/Outfit.ttf');
  });
});
