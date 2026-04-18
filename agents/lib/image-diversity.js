/**
 * Image prompt diversity system.
 *
 * Every generated post declares its cover image along six structured axes.
 * The batch is then audited to ensure no two pieces share the same
 * {shot_type, lighting} pair so the feed grid reads as visually varied
 * rather than one repeated photo.
 *
 * Axes are stored on content_queue.metadata.image_axes; the textual prompt
 * stays in content_queue.image_prompt for back-compat with the existing
 * render pipeline.
 */

export const AXES = {
  shot_type: [
    'pov_first_person',
    'over_shoulder',
    'wide_environmental',
    'medium',
    'close_up',
    'macro',
    'overhead_flat_lay',
  ],
  lighting: [
    'warm_golden_hour',
    'cool_blue_morning',
    'overcast_diffuse',
    'harsh_midday',
    'lamp_artificial_warm',
    'phone_screen_glow',
    'high_contrast_dramatic',
  ],
  palette: [
    'amber_cream',
    'cool_blue_gray',
    'muted_sage_olive',
    'blush_dusty_rose',
    'bw_high_contrast',
    'vibrant_saturated',
    'monochrome_single_hue',
  ],
  subject: [
    'rachel_hand',
    'kid_hand',
    'shared_hands',
    'object_only',
    'environment_only',
    'rachel_face_cropped',
  ],
  mood: [
    'quiet_grounding',
    'tender',
    'chaotic',
    'tired',
    'energetic',
    'playful',
    'reflective',
  ],
  rachel_mode: ['rachel_in_frame', 'broll'],
};

// Rachel is a standalone mom creator. When she's on-camera, she can only
// shoot where she actually lives — so prompts declaring rachel_in_frame
// must pick one of these scenes. B-roll has no such limit.
export const RACHEL_LOCATIONS = [
  'kitchen',
  'living_room_couch',
  'car_drivers_seat',
  'bedroom',
  'bathroom',
  'front_door_porch_walk',
  'school_pickup',
  'grocery_cafe',
];

/**
 * Decide rachel_mode from post_format. Avatar formats put Rachel on
 * screen; everything else is b-roll.
 */
export function pickRachelMode(postFormat) {
  if (postFormat === 'tiktok_avatar' || postFormat === 'tiktok_avatar_visual') {
    return 'rachel_in_frame';
  }
  return 'broll';
}

/**
 * Normalize a free-form axis value to a canonical slug.
 * Lowercases, collapses runs of non-alphanumerics to "_".
 */
export function normalizeAxisValue(val) {
  if (typeof val !== 'string') return null;
  const slug = val.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || null;
}

/**
 * Extract and normalize axes object from a post (or from a raw axes blob).
 * Result always has all six keys, possibly null.
 */
export function readAxes(post) {
  const raw =
    post && typeof post === 'object'
      ? post.image_axes || (post.metadata && post.metadata.image_axes) || {}
      : {};
  const out = {};
  for (const axis of Object.keys(AXES)) {
    out[axis] = normalizeAxisValue(raw[axis]) || null;
  }
  return out;
}

/**
 * Audit a batch for shot_type+lighting diversity.
 * @returns {{
 *   violations: Array<{index: number, key: string, dupOf: number}>,
 *   shotTypeCount: number,
 *   lightingCount: number,
 *   isDiverse: boolean
 * }}
 */
export function auditBatchDiversity(posts) {
  const seenByKey = new Map();
  const violations = [];
  const shotTypes = new Set();
  const lightings = new Set();

  posts.forEach((post, index) => {
    const axes = readAxes(post);
    if (axes.shot_type) shotTypes.add(axes.shot_type);
    if (axes.lighting) lightings.add(axes.lighting);
    const key = `${axes.shot_type || 'unknown'}|${axes.lighting || 'unknown'}`;
    if (seenByKey.has(key)) {
      violations.push({ index, key, dupOf: seenByKey.get(key) });
    } else {
      seenByKey.set(key, index);
    }
  });

  const targetDistinctShots = Math.min(4, posts.length);
  return {
    violations,
    shotTypeCount: shotTypes.size,
    lightingCount: lightings.size,
    isDiverse: violations.length === 0 && shotTypes.size >= targetDistinctShots,
  };
}

/**
 * Given a set of already-taken {shot_type, lighting} pairs, suggest the
 * next combination that is NOT taken. Used to steer a regeneration call.
 */
export function suggestUntakenAxes(takenPairs) {
  const taken = new Set(
    (takenPairs || []).map((p) => `${p.shot_type || ''}|${p.lighting || ''}`),
  );
  for (const shot of AXES.shot_type) {
    for (const light of AXES.lighting) {
      if (!taken.has(`${shot}|${light}`)) {
        return { shot_type: shot, lighting: light };
      }
    }
  }
  return { shot_type: AXES.shot_type[0], lighting: AXES.lighting[0] };
}

/**
 * Instructional text block for the content-generation LLM. Asks it to emit
 * axes explicitly alongside the textual prompt and respect the
 * Rachel-location constraint.
 */
export function buildImagePromptGuidelines(rachelMode) {
  const locationLine =
    rachelMode === 'rachel_in_frame'
      ? `Rachel-in-frame locations (pick ONE): ${RACHEL_LOCATIONS.join(', ')}`
      : 'B-roll / filler mode: ANY environment that supports the content. ' +
        'Macro details, environmental wides, product shots, kids\' hands, ' +
        'objects, textures. NOT limited to Rachel\'s real-world locations.';

  const fmt = (arr) => arr.map((v) => `"${v}"`).join(', ');

  return `## Image Prompt Axes (REQUIRED per post)

Return image_prompt as an OBJECT (not a string) with this shape:
{
  "prompt": "Full DALL-E prompt. NO FACES EVER.",
  "axes": {
    "shot_type": one of [${fmt(AXES.shot_type)}],
    "lighting": one of [${fmt(AXES.lighting)}],
    "palette": one of [${fmt(AXES.palette)}],
    "subject": one of [${fmt(AXES.subject)}],
    "mood": one of [${fmt(AXES.mood)}],
    "rachel_mode": "${rachelMode}"
  }
}

## Location constraint
${locationLine}

## Batch-level rule
Across this batch, NO TWO posts may share the same shot_type + lighting
combination. Maximize variation across every axis. The grid must feel
visually diverse — not one repeated photo.`;
}
