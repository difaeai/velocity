/** A person's own video or pictures: what the desk accepts, and what they can go out as. */
import { describe, expect, it } from 'vitest';

import { ownFormat, ownKind } from '../types';

describe('own uploads', () => {
  it('takes the videos every network accepts, and pictures', () => {
    expect(ownKind('video/mp4')).toBe('video');
    expect(ownKind('video/quicktime')).toBe('video');
    expect(ownKind('image/png')).toBe('image');
  });

  it('refuses what Instagram or Facebook would refuse later', () => {
    expect(ownKind('video/webm')).toBeNull();
    expect(ownKind('application/pdf')).toBeNull();
  });

  it('never makes a video into a picture post', () => {
    expect(ownFormat(['video'], 'post')).toBe('reel');
    expect(ownFormat(['video'])).toBe('reel');
    expect(ownFormat(['video'], 'video')).toBe('video');
  });

  it('makes a reel from pictures unless asked otherwise', () => {
    expect(ownFormat(['image', 'image'])).toBe('reel');
    expect(ownFormat(['image', 'image'], 'reel')).toBe('reel');
    expect(ownFormat(['image'], 'post')).toBe('post');
  });

  it('keeps every picture when several are given for a one-picture post', () => {
    expect(ownFormat(['image', 'image'], 'post')).toBe('carousel');
    expect(ownFormat(['image', 'image'], 'story')).toBe('carousel');
  });
});
