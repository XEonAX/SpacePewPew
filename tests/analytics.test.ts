import { describe, expect, it } from 'vitest';
import { shouldPingAnalytics } from '../src/app/analytics';

describe('analytics', () => {
  it('never pings local hosts', () => {
    expect(shouldPingAnalytics('localhost')).toBe(false);
    expect(shouldPingAnalytics('127.0.0.1')).toBe(false);
  });

  it('pings deployed hosts', () => {
    expect(shouldPingAnalytics('xeonax.github.io')).toBe(true);
    expect(shouldPingAnalytics('spacepewpew.example.com')).toBe(true);
  });
});
