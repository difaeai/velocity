import { describe, expect, it } from 'vitest';

import { otpComponents } from '../client';

/**
 * The payload shape is the thing that earns a 4xx on every single send, so it is
 * pinned here rather than discovered against a live number.
 *
 * These expectations were WRONG once, and expensively so. They asserted what
 * Meta's guides describe — copy-code buttons take a `coupon_code`, one-tap
 * buttons take text — and the tests passed while every real send came back
 * `(#132018) buttons: Button at index 0 must be of type Url`. The templates
 * Meta's authentication builder actually produces carry a **URL button**
 * (`https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&…&code=otp{{1}}`)
 * which WhatsApp merely *renders* as `Copy code`, so both kinds fill `{{1}}`
 * the same way.
 *
 * Verified against the live approved `velocity_login_code` template on
 * 2026-09-06: the coupon shape was rejected, the URL shape was accepted.
 */
describe('otpComponents', () => {
  it('always puts the code in the body', () => {
    for (const button of ['copy_code', 'one_tap', 'coupon_code', 'none'] as const) {
      expect(otpComponents('123456', button)[0]).toEqual({
        type: 'body',
        parameters: [{ type: 'text', text: '123456' }],
      });
    }
  });

  // The regression. An authentication template's button is a URL button
  // whichever of the two it looks like to the recipient.
  it.each(['copy_code', 'one_tap'] as const)(
    'sends a %s button as a url sub_type with text',
    (button) => {
      expect(otpComponents('123456', button)[1]).toEqual({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '123456' }],
      });
    },
  );

  // The escape hatch, for a genuine COPY_CODE-type button. Kept because the
  // shape exists on marketing coupon templates — just not on this one.
  it('sends the legacy coupon shape only when it is asked for by name', () => {
    expect(otpComponents('123456', 'coupon_code')[1]).toEqual({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: '123456' }],
    });
  });

  // A button component sent against a template that has no button is rejected
  // just as hard as sending the wrong kind.
  it('sends no button component at all when the template has no button', () => {
    expect(otpComponents('123456', 'none')).toHaveLength(1);
  });

  it('carries leading zeros through untouched', () => {
    const [body, button] = otpComponents('000123', 'copy_code') as [
      { parameters: { text: string }[] },
      { parameters: { text: string }[] },
    ];
    expect(body.parameters[0].text).toBe('000123');
    expect(button.parameters[0].text).toBe('000123');
  });
});
