/**
 * Hand-rolled Jaro-Winkler string similarity, returning a score in [0, 1].
 * Owned directly rather than pulled in as a dependency since it's core dedup
 * logic — worth being able to read and adjust without an opaque third-party
 * implementation in the way.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);

  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions = transpositions / 2;

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  // Winkler adjustment: boost similarity for strings sharing a common prefix (up to 4 chars).
  let prefixLength = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefixLength < maxPrefix && a[prefixLength] === b[prefixLength]) {
    prefixLength++;
  }

  const scalingFactor = 0.1;
  return jaro + prefixLength * scalingFactor * (1 - jaro);
}
