/**
 * Joins Vite's `import.meta.env.BASE_URL` with a relative asset path.
 *
 * `BASE_URL` always ends with a slash, but keeping this function tolerant of
 * both shapes makes it easy to reuse (and test) outside the bundler.
 */
export function joinBaseUrl(base: string, relativePath: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

  return `${normalizedBase}${normalizedPath}`;
}
