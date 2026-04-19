/**
 * Content batch LLM call + JSON parse/repair.
 *
 * Extracted from agents/content.js so the function can be unit-tested
 * without triggering content.js's auto-main side effects (env checks,
 * Supabase + Anthropic client instantiation, main()). The extraction
 * also closed a regression where the cost-log description referenced
 * a dropped `numOpps` variable — see the test file for the pinning
 * assertion.
 *
 * Callers pass fully-built `systemPrompt` / `userPrompt` strings and
 * an optional deps bundle so tests can inject a fake Anthropic client
 * and capture cost-log events.
 */

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const HAIKU_REPAIR_MODEL = 'claude-haiku-4-5';

/**
 * @param {{briefing: {id: string, opportunities: Array}, systemPrompt: string, userPrompt: string}} inputs
 * @param {{client: {messages: {create: Function}}, log: Function, db: any}} deps
 * @returns {Promise<{posts: Array, usage: object}>}
 */
export async function generateBatch(
  { briefing, systemPrompt, userPrompt },
  { client, log, db } = {},
) {
  if (!client) throw new Error('generateBatch: missing deps.client (Anthropic client)');
  if (!log) throw new Error('generateBatch: missing deps.log (cost logger)');

  console.log(`[Content] Calling Claude (${CLAUDE_MODEL})...`);
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  await log(db, {
    pipeline_stage: 'content_generation',
    service: 'anthropic',
    model: CLAUDE_MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    briefing_id: briefing.id,
    description: `Content batch generation (${briefing.opportunities.length} opportunities)`,
  });

  let text = msg.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  }

  // Attempt 1: Direct JSON.parse
  try {
    return { posts: JSON.parse(text), usage: msg.usage };
  } catch (err1) {
    console.warn(`[Content] JSON parse attempt 1 failed: ${err1.message}`);
  }

  // Attempt 2: Regex extraction
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const posts = JSON.parse(match[0]);
      console.warn('[Content] JSON recovered via regex extraction');
      return { posts, usage: msg.usage };
    }
    console.warn('[Content] No JSON array found via regex');
  } catch (err2) {
    console.warn(`[Content] JSON parse attempt 2 (regex) failed: ${err2.message}`);
  }

  // Attempt 3: Haiku repair
  try {
    console.log('[Content] Attempting JSON repair via Haiku...');
    const repairMsg = await client.messages.create({
      model: HAIKU_REPAIR_MODEL,
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `The following text is supposed to be a valid JSON array but has syntax errors. Fix the JSON and return ONLY the valid JSON array. No explanation, no code fences, no extra text.\n\n${text}`,
      }],
    });
    let repaired = repairMsg.content[0].text.trim();
    if (repaired.startsWith('```')) {
      repaired = repaired.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
    }
    const posts = JSON.parse(repaired);
    console.warn('[Content] JSON recovered via Haiku repair');
    await log(db, {
      pipeline_stage: 'content_generation',
      service: 'anthropic',
      model: HAIKU_REPAIR_MODEL,
      input_tokens: repairMsg.usage.input_tokens,
      output_tokens: repairMsg.usage.output_tokens,
      briefing_id: briefing.id,
      description: 'JSON repair (Haiku fallback)',
    });
    return { posts, usage: msg.usage };
  } catch (err3) {
    console.error(`[Content] JSON repair attempt 3 (Haiku) failed: ${err3.message}`);
  }

  console.error('[Content] All JSON parse attempts failed. Raw text (first 500 chars):');
  console.error(text.slice(0, 500));
  throw new Error('JSON parse failed after 3 attempts (direct, regex, Haiku repair)');
}
