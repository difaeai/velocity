import { describe, expect, it } from 'vitest';

import { otpComponents } from '../client';

/**
 * The payload shape is the thing that earns `(#100) Invalid parameter`, and the
 * two OTP button kinds do NOT take the same component — copy-code buttons want a
 * `coupon_code` parameter, one-tap buttons want plain text. Getting it wrong
 * fails identically for every recipient, which is why `(#100)` is classified as
 * `halt` in the first place. So the shape is pinned here rather than discovered
 * against a live number.
 */
describe('otpComponents', () => {
  it('always puts the code in the body', () => {
    for (const button of ['copy_code', 'one_tap', 'none'] as const) {
      expect(otpComponents('123456', button)[0]).toEqual({
        type: 'body',
        parameters: [{ type: 'text', text: '123456' }],
      });
    }
  });

  it('sends a copy-code button as a coupon_code parameter', () => {
    expect(otpComponents('123456', 'copy_code')[1]).toEqual({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: '123456' }],
    });
  });

  it('sends a one-tap button as a url sub_type with text', () => {
    expect(otpComponents('123456', 'one_tap')[1]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: '123456' }],
    });
  });

  // A button component sent against a template that has no button is the same
  // `(#100)` as sending the wrong kind.
  it('sends no button component at all when the template has no button', () => {
    expect(otpComponents('123456', 'none')).toHaveLength(1);
  });

  it('carries leading zeros through untouched', () => {
    const [body, button] = otpComponents('000123', 'copy_code') as [
      { parameters: { text: string }[] },
      { parameters: { coupon_code: string }[] },
    ];
    expect(body.parameters[0].text).toBe('000123');
    expect(button.parameters[0].coupon_code).toBe('000123');
  });
});
