/** Visit ping behaviour, kept out of the scene so it stays easy to test. */

/** Local development and tests should never phone home. */
export function shouldPingAnalytics(hostname: string): boolean {
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
}

/**
 * Fire-and-forget visit ping. Uses `no-cors` because the endpoint is a simple
 * counter; failures are silent so analytics can never break or delay the game.
 */
export function pingVisit(): void {
  const location = window.location;
  if (!shouldPingAnalytics(location.hostname)) return;

  try {
    fetch(`https://ping.aeonax.com/${location}`, {
      mode: 'no-cors',
      referrerPolicy: 'unsafe-url',
    }).catch(() => {
      // Silently fail if the ping endpoint is unavailable.
    });
  } catch {
    // Silently fail.
  }
}
