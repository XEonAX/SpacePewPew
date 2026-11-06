import { describe, expect, it } from 'vitest';
import { joinBaseUrl } from '../src/utils/paths';

describe('joinBaseUrl', () => {
  it('joins a root base', () => {
    expect(joinBaseUrl('/', 'audio/blip.wav')).toBe('/audio/blip.wav');
  });

  it('adds a missing trailing slash to the base', () => {
    expect(joinBaseUrl('/game', 'audio/blip.wav')).toBe('/game/audio/blip.wav');
  });

  it('strips a leading slash from the path', () => {
    expect(joinBaseUrl('/', '/audio/blip.wav')).toBe('/audio/blip.wav');
  });

  it('works with absolute CDN-like bases', () => {
    expect(joinBaseUrl('https://example.com/app/', 'audio/blip.wav')).toBe(
      'https://example.com/app/audio/blip.wav',
    );
  });
});
