/**
 * Tiny, dependency-free CLI arg parser for the content agent (YAR-142).
 *
 * The daily cron invokes `node agents/content.js` with NO flags, which
 * MUST parse to batch defaults (every field falsy) so behavior stays
 * byte-identical to the greedy batch path. The flags below opt into the
 * single-row regenerate mode.
 *
 * Supported:
 *   --content-id=<uuid>     regenerate this content_queue row
 *   --briefing-json=<path>  use the opportunity in this JSON file as the
 *                           synthetic-briefing override
 *   --force-profile=<slug>  override render_profile_slug on the regen
 *   --dry-run               print result, write nothing
 *
 * Unknown / malformed args are ignored (no throw) so the cron path is
 * never accidentally broken by an extra flag.
 *
 * @param {string[]} argv  Typically process.argv.slice(2).
 * @returns {{ contentId: string|null, briefingJson: string|null, forceProfile: string|null, dryRun: boolean }}
 */
export function parseContentArgs(argv) {
  const args = {
    contentId: null,
    briefingJson: null,
    forceProfile: null,
    dryRun: false,
  };

  for (const token of Array.isArray(argv) ? argv : []) {
    if (typeof token !== 'string') continue;

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    const eq = token.indexOf('=');
    if (eq === -1) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);

    switch (key) {
      case '--content-id':
        args.contentId = value || null;
        break;
      case '--briefing-json':
        args.briefingJson = value || null;
        break;
      case '--force-profile':
        args.forceProfile = value || null;
        break;
      default:
        // ignore unknown flags
        break;
    }
  }

  return args;
}
