/**
 * The handler React Native already has is what closes the app on a fatal
 * error. Ours sits in front of it, so it must hand every error on — once, and
 * no matter what the report does — or a crash turns into a frozen screen, or
 * the system handler runs twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chainCrashHandler } from '../crashHandler';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('chainCrashHandler', () => {
  it('reports a non-fatal error and hands it on at once', () => {
    const previous = vi.fn();
    const report = vi.fn(() => new Promise<void>(() => {}));
    chainCrashHandler(previous, report)('boom', false);
    expect(report).toHaveBeenCalledWith('boom', false);
    expect(previous).toHaveBeenCalledWith('boom', false);
  });

  it('holds a fatal error until the report is sent, then hands it on once', async () => {
    const previous = vi.fn();
    let sent!: () => void;
    const report = vi.fn(() => new Promise<void>((r) => (sent = r)));
    chainCrashHandler(previous, report)('boom', true);
    expect(report).toHaveBeenCalledWith('boom', true);
    expect(previous).not.toHaveBeenCalled();

    sent();
    await vi.advanceTimersByTimeAsync(0);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith('boom', true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('hands a fatal error on after the hold when the report never finishes', async () => {
    const previous = vi.fn();
    chainCrashHandler(previous, () => new Promise<void>(() => {}), 1500)('boom', true);
    await vi.advanceTimersByTimeAsync(1499);
    expect(previous).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('hands a fatal error on when the report fails', async () => {
    const previous = vi.fn();
    chainCrashHandler(previous, () => Promise.reject(new Error('offline')))('boom', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(previous).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(previous).toHaveBeenCalledTimes(1);
  });
});
