# SMT — Video Format Partner Brief

**For:** [Partner name]
**From:** Yaron Orenstein, SMT
**Purpose:** Scope the video format specifications and AI service stack that will power SMT's content generation.
**Prerequisites:** You've read *The Story and Motivation Behind SMT* and *The Face of SMT*.

---

## 1. What you're building

We're replacing our existing content-generation layer. Your deliverables — prompt designs and AI stack recommendations for video and audio generation — will become the creative engine that feeds our production pipeline.

**In scope for your work:**
- Prompt structure and content for each of the five video formats below
- Recommended AI services for video generation, image generation, TTS, and any supporting generation (music, sound design, etc.)
- Output schemas that feed downstream rendering

**Out of scope:**
- Downstream video composition and rendering (handled internally)
- Publishing, scheduling, analytics
- Research and signal sourcing (handled by our Research layer, which passes you structured signals to render)
- Static carousel / photo posts (not a video output — handled separately)

---

## 2. Creative philosophy — the non-negotiables

**Pacing.** Short-form content has three beats: **Hook (0–3s), Magic (3–10s), Payoff (10–15s).** Longer formats (Ask Rachel, AI Magic Video) extend this up to 45s but never at the cost of early payoff density. The first 3 seconds earn the rest.

**Content type mix.** Roughly 60% Wow / 30% Trust / 10% CTA across all output. Wow = scroll-stopping discovery. Trust = emotional reframe / lived experience. CTA = explicit ask, used sparingly.

**The test every piece must pass.**
> Would a 38-year-old mom watching this feel *let in on something* — or *talked down to*?

If the answer is the second one, it fails. This matters more than any single rule below.

**Lead with magic, follow with mechanism.** We show the result first, then reveal how. Rachel doesn't gatekeep. She's the friend who tells you exactly what tool she used and what she typed. No teacher-voice, no "link in bio for my course."

**Degrade honestly, never fake.** When visual proof is required but unavailable, we step *down* in source quality rather than fabricate. Real demo footage → category stock → re-route to avatar-only. We never AI-generate products, interfaces, or demos we don't have real footage for. A vaguer video beats a fake one every time.

**Financial content is first-person only.** For the Financial pillar (5% of content), Rachel shares lived experience — never gives advice. Safe: *"Here's what we do with my kid's allowance."* Unsafe: *"You should put it in a custodial Roth."* Every Financial post includes an automatic caption disclaimer. No specific financial products named, no stocks, no crypto, no tax or legal specifics.

---

## 3. Pillar → Format routing

SMT covers five content pillars (topics). Each pillar has preferred delivery formats. This mapping is referenced throughout the document.

| Pillar | Primary format(s) | Secondary |
|---|---|---|
| Parenting Insights | Avatar Full, Ask Rachel | Avatar + Visual |
| Mom Health & Wellness | Avatar Full, Ask Rachel | — |
| AI Magic | **AI Magic Video only** | — |
| Tech for Moms | Avatar + Visual | Avatar Full, Moving Images |
| Trending & Culture | Moving Images, Ask Rachel (reactive takes) | Avatar Full |
| Financial | Avatar Full, Ask Rachel | Avatar + Visual, AI Magic Video (when AI tool applies), Moving Images |

**Rachel format distribution** (across all Rachel-delivered content): approximately 55% Avatar Full, 30% Ask Rachel, 15% Avatar + Visual. Your prompt library and stack recommendations should match this weighting.

**Pillar-format lock:** AI Magic runs only as AI Magic Video. Never substituted.

---

## 4. The five video formats

Every piece of content maps to one of these. Each has a fixed structural intent — the prompts you design must honor the intent, not just the surface. Full production instructions and sample scripts for each format are in the Appendix.

### Format 1 — Avatar Full
**Duration:** 15–60s.
**Audio:** Rachel's locked voice (see §6). Emotional range required — not performatively cheerful.
**Best for:** Personal discoveries, hot takes, "okay wait—" moments. Rachel's most frequent format.

**Structure:**

| Segment | Duration | Visual | Audio |
|---|---|---|---|
| Hook | 0–3s | Rachel full-frame, already in frame, no warm-up | Rachel mid-thought ("Okay wait—", "Nobody talks about this and they should…") |
| Body | 3s–payoff | Rachel full-frame, 2–6 clips stitched with consistent wardrobe + background | Conversational delivery, 1–2 specific personal references, dry wit moments |
| Payoff | Final 3–5s | Rachel full-frame | Single-line reframe or takeaway. No outro, no sign-off. |

### Format 2 — Avatar + Visual (50/50 split)
**Duration:** 15–60s.
**Audio:** Rachel's voice throughout, continuous.
**Best for:** Product/app reviews, comparisons, anything where showing beats telling.

**Structure:**

| Segment | Duration | Visual | Audio |
|---|---|---|---|
| Hook | 0–3s | 100% Rachel full-frame | Hook line — earns her presence before splitting |
| Split body | 3s–onward | Top half: B-roll / product shot / reference imagery. Bottom half: Rachel talking. Held through emphasis moments. | Rachel continues, visual sharpens the claim |
| Visual emphasis | 2–4s beats | Occasional 100% visual cuts when the image *is* the point | Rachel VO continues |
| Payoff | Final 3–5s | Return to 100% Rachel | Takeaway line |

Transitions are soft crossfades only (0.3–0.5s) — never hard cuts between Rachel and visual. Max 3–4 visual emphasis moments per video.

**Visual sourcing:** See §5 for the universal B-roll and visual sourcing logic, including source-footage tiering, attribution rules, and format-specific notes.

### Format 3 — AI Magic Video
**Duration:** 20–40s.
**Audio:** Rachel's voice throughout (see §6). Narration continuous across on-camera + static-slide segments.
**Best for:** AI Magic pillar only. The only format this pillar uses.

**Structure — Result → Reveal → Reaction:**

| Segment | Duration | Visual | Audio |
|---|---|---|---|
| Hook | 2–4s | Rachel on camera | Hook line ("Okay wait — this just replaced three apps on my phone") |
| Input reveal | 2–3s | Static slide: the prompt as screenshot-style text on branded background | Rachel VO: "Here's what I typed…" |
| Output showcase | 8–20s | 2–5 static slides showing the AI's output, formatted like a saveable carousel, with subtle Ken Burns or auto-advance | Rachel VO narrating the output |
| Payoff | 3–5s | Rachel on camera | Reaction line ("I've been using this every night for a week") |

**Two narration modes:**
- **Highlights (default):** Rachel narrates opening + key moments. "I'll drop the full thing in the comments." Tighter pacing, drives comment engagement.
- **Full:** Rachel narrates the complete output. Used when output is inherently short (meal plan, teacher email, conversation starter).

**Critical rules:**
- Tool name is always spoken. Rachel doesn't hide what she uses.
- Prompt is always shown on-screen. Moms screenshot these.
- The output must be genuinely useful, not a gimmick.
- Never sponsor-tone. She's recommending a friend to a friend.
- **Output slides are composed, not sourced** — stylized text-over-branded-background, not Tier 1 footage. See §5.4 for details.

### Format 4 — Ask Rachel
**Duration:** 20–45s.
**Audio:** Interviewer voice (from a pool — see §6) asks. Rachel answers.
**Best for:** Defensible takes, reactive trending content, topics that benefit from the expert-consulted frame.

**Structure:**

| Segment | Duration | Visual | Audio |
|---|---|---|---|
| Hook — the question | 3–5s | Text card with question, podcast-show aesthetic | Interviewer voice asks |
| Rachel setup | 2–3s | Rachel on camera, beat | Silence, then begins |
| Rachel answers | 12–30s | Rachel full-frame, occasional 50/50 for emphasis | Rachel's answer |
| Payoff | 3–5s | Rachel on camera | Takeaway line |

**The three question patterns Rachel answers:**

| Pattern | Use when signal is | Example |
|---|---|---|
| **"Why"** | A pattern or behavior | *"So Rachel — why do teens shut down at the dinner table?"* |
| **"How do you"** | A challenge or skill | *"Rachel, how do you set screen time limits without it becoming a war?"* |
| **"What do you think"** | A take-worthy viral or news moment | *"Rachel — that viral take on gentle parenting. What's your honest read?"* |

**Question rules:**
- Must start with Rachel's name.
- Under 15 words.
- Not multi-part.
- Must have a clear, defensible answer she can deliver in 15–30 seconds.
- Must read as a real question a real mom might ask.

### Format 5 — Moving Images
**Duration:** 30–90s.
**Audio:** Female TTS voiceover, natural delivery, warm mid-30s tone. Distinct from Rachel. No avatar anywhere in this format.
**Best for:** Foundation volume, Trending & Culture takes, topics where avatar production is unnecessary. Our lowest-priority format — useful but least differentiated.

**Structure:**

| Segment | Duration | Visual | Audio |
|---|---|---|---|
| Hook slide | 4–6s | Full-bleed stock photography, text overlay on contrasted panel, scroll-stopping claim | TTS voiceover delivers the hook line |
| Content slides | 2–4 slides, 8–12s each | Stock photography, text emphasis overlays, Ken Burns / crossfade motion | TTS narrates the build — specifics, evidence, examples |
| Takeaway slide | 6–10s | Same aesthetic, the "so what" moment highlighted in text | TTS delivers the actionable takeaway |
| CTA slide | 4–6s | Soft warm background, CTA text overlay | TTS delivers save-oriented CTA ("Save this for the next time…") |

---

## 5. Visual sourcing logic

B-roll and visual content appear in three of our five formats — Avatar + Visual (top-half visuals), AI Magic Video (output showcase), and Moving Images (slide backgrounds). The sourcing rules are universal across all three; format-specific notes follow.

### 5.1 The sourcing hierarchy

Four tiers, applied in strict priority order. Always prefer the highest tier available; step down only when the higher tier isn't viable.

| Tier | Source | When to use |
|---|---|---|
| **Tier 1 — Source material** | Demo footage, clips, or images from the original signal (creator videos, brand demos, news clips, product pages) | Whenever the research signal includes demo/reference material. Most common for Tech for Moms and Trending & Culture. |
| **Tier 2 — Licensed stock** | Stock photography/video libraries (Pexels-grade or equivalent). Warm, intimate, real-life moments matching brand aesthetic. | Default for illustrating techniques, behaviors, or abstract claims where source material doesn't exist or doesn't fit. |
| **Tier 3 — Real capture** | Footage we produce ourselves (product shots, real kid moments, lived-moment B-roll) | Rare, out of partner scope. Flag in output schema when content would ideally use it, so content-ops can source. |
| **Tier 4 — Re-route** | Drop the visual claim entirely and produce the content in a non-visual format (typically Avatar Full) | When none of the above can credibly support the claim. Tech for Moms lists Avatar Full as secondary routing for exactly this case. |

### 5.2 What we never do

Hard rules. No exceptions.

- **AI-generated products, interfaces, or fake demos** — trust-breaker, degrades the brand. If we can't show the real thing, we don't fake it.
- **AI-generated imagery representing real things** — real apps, real products, real people. Always real or stylized-as-illustration, never photorealistic-and-fake.
- **Stock imagery that fakes specificity** — a generic phone mockup standing in for "the app Rachel uses" is a lie. Either show the actual app (Tier 1) or don't show a phone at all.
- **Platform watermarks from the source** — any TikTok or Reels watermark visible in our uploads is an algorithmic penalty. Source footage must be clean-ripped or obtained without watermarks.

### 5.3 What we sometimes do, with rules

- **AI-generated imagery for abstract concepts** — e.g., an abstract illustration of "the mental load." Allowed, but must be clearly stylized (illustrative, not photorealistic) so viewers read it as illustration, not reality.
- **Composite imagery** — text over stock, stylized slides for AI output showcase, branded frames around Tier 1 footage. This is our template language. Standard.
- **Source footage with attribution** — standard when properly credited in caption (see §5.5).

### 5.4 Format-specific notes

| Format | B-roll role | Sourcing notes |
|---|---|---|
| **Avatar + Visual** | Top-half visual proof during 50/50 segments, occasional full-frame cuts | Tier 1 preferred for Tech for Moms (tool demos, app screen recordings from the original source). Tier 2 acceptable for Parenting Insights / Mom Health where technique benefits from visualization. Tier 4 (re-route to Avatar Full) when neither works. |
| **AI Magic Video** | Output showcase slides are *composed*, not sourced — text-over-branded-background, stylized. Hook/payoff are Rachel on camera, no B-roll needed. | Exception: if the output involves a real-world moment worth showing (e.g., parent-child interaction), Tier 2 stock can be used as a subtle backdrop behind output slides. Never Tier 1 — AI Magic doesn't attribute externally because the content is Rachel's own workflow. |
| **Moving Images** | Every slide has a photographic background | Tier 2 is this format's core aesthetic — warm, golden-hour, intimate family moments. Tier 1 only when the signal itself is visual (news clip, viral moment). Faces generally avoided. |

### 5.5 The universal attribution rule

**Whenever Tier 1 (source material) is used, the caption must credit the original source.** Attribution formats:

- Creator attribution: *"via @handle"* or *"credit @handle"* in-caption, plus tag in the post
- Brand attribution: *"demo from [brand]"*
- News/study attribution: named in-content by Rachel or shown on-slide

Attribution is **mandatory, not optional.** Your caption generator must produce this automatically when `visual_source_tier = source_material`.

### 5.6 Schema — what your prompts consume and emit

**Research passes in** (when available):
- `source_demo_assets` — array of URLs or asset references to demo videos, screen recordings, or images from the original signal
- `source_attribution` — creator handle, brand name, or study/article reference for attribution

**Your prompts emit** (per piece):
- `visual_source_tier` — one of `source_material` | `licensed_stock` | `real_capture_needed` | `rerouted_avatar_full`
- `visual_references` — specific asset references or stock query terms per beat
- `attribution_required` — boolean, set `true` when tier is `source_material`
- `attribution_text` — formatted attribution string for caption inclusion

---

## 6. Voice specifications

### Rachel — locked
Rachel's voice is fixed: ElevenLabs, warm mid-30s American English. Natural pacing with real pauses. Emotional range required across serious and light moments. Your prompts should build natural breath and hesitation ("okay wait—", "I mean…", commas and em-dashes as audio pauses). **Not** broadcast polish. She sounds like a voice memo to a friend.

Signature beats, banned phrases, and pacing rules are documented in *The Face of SMT*. Your prompts must enforce those constraints.

### Interviewer pool — open for your recommendation
Ask Rachel uses a pool of **2–3 interviewer voices**, rotated per post. These are unnamed show infrastructure, not personalities. Selection criteria:

- Clearly distinct from Rachel's voice (gender, age, or timbre contrast)
- Podcast-host quality — warm, structured, not sales-y, not news-anchor
- Able to handle all three question patterns convincingly

**Part of your deliverable:** recommend the 2–3 voices, with samples. V1 rotation is random; V2 can be topic-matched (e.g., more skeptical voice for "what do you think" questions) — design the pool with that in mind.

### Moving Images narrator — open for your recommendation
Moving Images uses a female TTS voice, warm mid-30s, distinct from Rachel (Rachel is reserved for on-camera formats only). Recommend a voice that fits the brand — warm, intimate, thoughtful. Single voice, no rotation needed.

### Other AI services
We currently use specific services for TTS, image generation, stock sourcing, and video composition. **All of this is open for your recommendation.** Evaluate on quality, cost per output, consistency, and fit with these formats. Your AI stack proposal should include:

- Video/avatar rendering service (Rachel is already locked to her specific avatar — recommendations should preserve that)
- TTS services (Rachel's voice ID is locked to a specific provider — preserve that; flexible on everything else, including interviewer and Moving Images narrator)
- Image generation (for Format 3 output slides)
- Stock photo/video sourcing (for Format 2 B-roll, Format 5 slideshow backgrounds)
- Music / sound design if you recommend any

Provide cost-per-output estimates per format.

---

## 7. Production parameters

**Cadence.** We produce approximately 2 content pieces per day, each delivered to both Instagram and TikTok = 4 uploads per day. Your prompts need to support this volume with consistent quality.

**Aspect ratio.** All five formats output at 1080×1920 (9:16 vertical). Single aspect for all video.

**Cross-post model.** One render file is uploaded to both platforms — no re-export. But the **captions and hashtags are platform-native** (IG long-form 100–180 words, TT short 2–3 lines max 40 words). Your prompt output schemas must generate both caption variants per piece.

**Language.** English, US parenting audience. Warm, peer-to-peer tone across all formats.

---

## 8. Quality bar — what "done" looks like

Every generated piece must pass all of these:

- Hook is scroll-stopping in the first 3 seconds
- Pillar and age range (toddler 1–3, little kid 4–7, school age 8–12, teen 13–16, or universal) correctly tagged
- Voice passes the Rachel filter: no credentialing, no teacher-voice, no hollow affirmations, no "hey moms," no "mama bear"
- The "let in on something" test passes — peer tone, never condescending
- Platform-native captions and hashtags both generated
- No platform watermarks (TikTok watermark on Instagram content, or Reels watermark on TikTok content, are algorithmic penalties)
- Format-specific gates: AI Magic shows the prompt + names the tool; Ask Rachel starts with her name, uses one of the three patterns
- **Financial-pillar-specific gates:** first-person framing only (no "you should…" directives); no specific financial products, stocks, or crypto named; mandatory disclaimer present at end of caption
- Natural emoji usage — max 1–2 per caption, never performative

We have an automated QA layer that scores on these, but your prompts should be designed so QA rarely has to reject.

---

## 9. What we're asking from you

1. **Prompt designs** for each of the five formats. Each should specify: input schema (what signal/topic data comes in), intermediate reasoning structure, output schema that feeds rendering.
2. **AI stack recommendation:** which services you'd use for video, TTS (beyond Rachel's locked voice), image generation, stock sourcing, and any supporting layers. With cost-per-output estimates.
3. **Interviewer voice pool proposal:** 2–3 voice samples with rationale. Plus Moving Images narrator recommendation.
4. **Integration plan:** at a high level, how your output schemas would flow into a rendering pipeline. We handle composition; you hand off structured content.

Scope, timeline, and commercials TBD after we align on approach.

---

# Appendix — Production instructions & sample scripts

Two sample scripts per format, paired with the production instructions that produced them. The instructions are the creative framework your prompts must encode; the samples are examples of what passing output looks like.

---

## A1. Avatar Full — Instructions

**Target duration:** 15–60s. Sweet spot 20–35s.
**Script length:** ≈3 words per second (75 words ≈ 25s).

**Structure:**
- Hook (0–3s): Rachel already talking as frame opens. No warm-up.
- Body (3s–payoff): Conversational delivery. Include 1–2 specific personal examples; Rachel has three kids (5, 11, 15 — oldest a teen boy). Reference their ages or behaviors when it sharpens the point.
- Payoff (final 3–5s): Single-line reframe or takeaway. No outro.

**Hook rules:**
- Statement hook, reframe, or "nobody talks about" discovery
- Never a question (questions live in Ask Rachel format)
- Never self-credentialing ("as a mom of three")
- Open mid-sentence if needed — she's already in the middle of thinking it

**Body rules:**
- Short sentences. Punchy. Real.
- At least one moment of dry wit, self-deprecation, or unexpected angle
- Specificity beats generality — "my 15-year-old talked for seven minutes" beats "teens open up"
- Commas and em-dashes become audio pauses — use them

**Payoff rules:**
- Land on the takeaway, not a sign-off
- No "comment below," no "you got this"
- Often a single-line reframe that recontextualizes the body

### Sample Script 1 — Avatar Full (Parenting Insights, Teen, ~28s)

**[HOOK | 0–3s | Rachel in kitchen, already talking, hands free]**
"Okay wait — if you ask your 15-year-old 'how was school' one more time and they say 'fine,' try this instead."

**[BODY | 3–20s]**
"Ask them about one specific person. 'Did Marcus sit with you at lunch?' 'Is Ms. Chen still weird about the phones?' I stumbled into this a month ago because I was half-listening and just grabbed a name out of something he'd mentioned Tuesday."

*(beat — slight half-smile)*

"He talked for seven minutes. About school. Voluntarily."

**[PAYOFF | 20–28s]**
"It's not that they don't want to tell you things. It's that 'how was school' is so big they can't answer it. Give them something they can."

### Sample Script 2 — Avatar Full (Mom Health, ~26s)

**[HOOK | 0–3s | Rachel on couch]**
"Nobody talks about this and they should — the 'just five more minutes' thing isn't laziness. It's grief."

**[BODY | 3–19s]**
"That window between when your alarm goes off and when you actually get up? That's the only time of day that is yours. No one's asking for anything, no one's hungry, no one's crying. Of course you don't want to end it."

*(pause)*

"The fix isn't discipline. It's giving yourself that time on purpose, somewhere else in the day, where you can actually enjoy it."

**[PAYOFF | 19–26s]**
"I started taking fifteen minutes in the afternoon. Door closed. Not productive, not a 'ritual' — just quiet. My mornings stopped being a battle."

---

## A2. Avatar + Visual (50/50) — Instructions

**Target duration:** 15–60s. Sweet spot 25–40s.
**All Avatar Full rules apply.** Additional rules specific to this format:

**Transition mechanics:**
- Always open 100% Rachel (hook earns her presence before splitting)
- Transition to 50/50 only at emphasis moments where visual proof sharpens the claim
- Brief 100% visual cuts (2–4s) allowed when the image *is* the point
- Always return to 100% Rachel for the payoff
- Soft transitions only — 0.3–0.5s crossfade. No hard cuts.
- Maximum 3–4 visual emphasis moments per video

**Visual content rules:**
- Real photography or real product/app screenshots only — never AI-generated products, fake interfaces, or illustrative-but-wrong imagery
- Must match the specific point being made at that moment — if Rachel says "this app tracks soccer cleats on Tuesday," the visual shows that
- Warm tone, consistent with brand aesthetic
- Faces generally avoided — hands, environments, objects

**When to use:**
- Product/app reviews where screenshots matter
- Comparisons (before/after, option A vs option B)
- Claims moms won't believe without seeing

### Sample Script 1 — Avatar + Visual (Tech for Moms, ~32s)
*Demonstrates Tier 1 sourcing: Rachel credits the original source creator and the video uses their demo footage with attribution.*

**[HOOK | 0–3s | Full Rachel]**
"Okay — this showed up in my feed last week and I've been using it every day since. Saw it first from @momhacksdaily."

**[BODY — 50/50 | 3–14s | Top half: source creator's demo clip of the app in action]**
"It's a family calendar that does the one thing every other calendar refuses to do — it tells the *kids* what they're responsible for. Not me."

**[BODY — 100% Visual | 14–20s | Continued source demo footage, zoomed on app sending a reminder]**
"Soccer cleats Tuesday. Permission slip Thursday. It pings them directly."

**[BODY — Full Rachel | 20–26s]**
"My 11-year-old texted me 'mom got goggles for Friday' on day three. She's never taken responsibility for anything before."

**[PAYOFF | 26–32s]**
"Tagging the creator in the comments — credit where it's due. This one's real."

### Sample Script 2 — Avatar + Visual (Parenting Insights, Little Kid, ~27s)

**[HOOK | 0–3s | Full Rachel]**
"Your 5-year-old isn't being dramatic. They just don't have the words yet."

**[BODY — 50/50 | 3–14s | B-roll of a child mid-meltdown in a kitchen]**
"When my youngest loses it over the wrong color cup — that's not about the cup. She can feel something is wrong, and 'wrong' is the biggest word she has."

**[BODY — 100% Visual | 14–19s | B-roll of a child calming down]**
"The fix isn't to explain. It's to name the feeling for her. 'You're frustrated.' That's it."

**[PAYOFF | 19–27s | Full Rachel]**
"I watch her shoulders drop every time. She doesn't need me to solve it. She needs me to tell her what she's feeling."

---

## A3. AI Magic Video — Instructions

**Target duration:** 20–40s.
**Structure:** Result (Hook) → Reveal (Input + Output) → Reaction (Payoff).

**Hook rules (on-camera Rachel):**
- Lead with the *result*, not the tool
- Right: "I just wrote the hardest email I've had to write this year…"
- Wrong: "I tried Claude for email writing…"
- Standard Rachel voice rules apply

**Input reveal rules (static slide):**
- Slide shows the exact prompt, legible, screenshot-style text on branded background
- Rachel voiceover: "Here's what I typed…" (or equivalent natural entry)
- Prompt must sound like a real mom typing — natural language, not polished prompt engineering
- Tool name is spoken aloud by Rachel before or during this segment

**Output showcase rules (2–5 static slides):**
- Each slide = one readable chunk of output
- Large, screenshot-friendly typography — moms save these
- Subtle Ken Burns / auto-advance motion
- Rachel narrates over the slides in her voice

**Narration mode selection:**
- **Highlights (default):** for long outputs (bedtime story, long email, weekly plan). Narrate opening + highlights only, promise "full thing in the comments"
- **Full:** for short outputs (meal plan, conversation starters, short email). Narrate the entire output.

**Payoff rules (on-camera Rachel):**
- Practical handoff — "copy the prompt," "feed it your own week," "drop the full thing in comments"
- Closes on reaction, not instructions
- Never sponsor-tone. Friend-to-friend recommendation only.

**Tool selection rules:**
- Only tools from the approved shortlist (provided separately — Rachel's AI tool stack)
- Tool is named naturally in the flow, not pitched
- Prompts must produce genuinely useful output — never gimmicky

### Sample Script 1 — AI Magic Video (Parenting Insights × AI Magic, Teen, ~32s)

**[HOOK | 0–4s | Rachel on camera]**
"Okay wait — I just wrote the hardest email I've had to write this year and it took eleven seconds."

**[INPUT REVEAL | 4–7s | Static slide: screenshot-style prompt text on dark branded background]**
*(Rachel VO):* "Here's what I typed into Claude:"

*On-screen prompt text:*
> Write a short email to my 15-year-old's soccer coach explaining why he won't be at practice Thursday. His grandfather is in the hospital. Keep it professional but warm. Don't make it depressing.

**[OUTPUT SHOWCASE | 7–22s | 3 static slides with the email output, each readable and screenshottable, Ken Burns motion]**
*(Rachel VO over slides):* "It came back with this — 'Hi Coach Dawson, I'm writing to let you know Marcus won't be at practice Thursday evening. He's going to be with family at the hospital — his grandfather is in a tough spot and we're all trying to be close this week. He'll be back by Sunday's game and is doing the conditioning on his own. Appreciate your understanding.'"

**[PAYOFF | 22–32s | Rachel on camera]**
"I've been staring at emails like that for twenty minutes at a time for years. Twenty minutes I didn't have. I've dropped the full prompt in the comments — change the coach's name, change the reason, done."

### Sample Script 2 — AI Magic Video (Mom Health × AI Magic, ~35s)

**[HOOK | 0–4s | Rachel]**
"I genuinely can't believe no one told me this would work. I gave Claude my mental load and it handed me back a week."

**[INPUT REVEAL | 4–8s | Static slide]**
*(Rachel VO):* "Here's exactly what I typed:"

*On-screen prompt text:*
> I have three kids (5, 11, 15). Here's everything on my plate this week: [list]. Organize it as a daily checklist, flag what actually needs me, and tell me what I can delegate to each kid by age.

**[OUTPUT SHOWCASE | 8–26s | 4 static slides — daily checklist formatted block by block, Ken Burns]**
*(Rachel VO):* "It gave me back a week, day by day. Monday mornings for me. Tuesday and Thursday — my 15-year-old's running homework check-ins for his sisters. My 11-year-old is now in charge of Saturday breakfast. And it flagged the three things nobody but me can do."

**[PAYOFF | 26–35s | Rachel]**
"I cried at my kitchen table on a Monday morning. The full prompt's in the comments. Feed it your week. Let it break the week down. I'm not going back."

---

## A4. Ask Rachel — Instructions

**Target duration:** 20–45s.
**Structure:** Question (text card + interviewer VO) → Rachel setup (beat) → Rachel answers → Payoff.

**Question generation (the three patterns):**

1. **"Why"** — for patterns and behaviors
2. **"How do you"** — for challenges and skills
3. **"What do you think"** — for takes on viral moments or news

**Question rules (hard constraints):**
- MUST start with "Rachel" or "So, Rachel—"
- Under 15 words
- Single question, not multi-part
- Must have a clear, defensible answer Rachel can deliver in 15–30 seconds
- Must read as a real question a real mom might ask — not rhetorical or setup-y

**Interviewer voice:**
- Drawn from the 2–3-voice pool you'll propose, rotated per post
- Tone: warm, curious, podcast-host. Not sales, not news anchor.
- Delivery: conversational, not dramatic

**Rachel setup (2–3s):**
- Rachel on camera, brief beat before speaking
- Half-smile, slight nod, or neutral expression — "gathering her thoughts"
- Never immediate talking — the beat is the format's signature

**Rachel's answer structure:**
- Premise ("Because…") → lived example ("So what I started doing…") → insight ("Which means…")
- All Avatar Full voice rules apply
- 50/50 split allowed for visual emphasis at key moments, but Rachel is the anchor
- Must actually *answer* the question in a specific way — no vague hedging

**Payoff (3–5s):**
- Single-line takeaway
- Recontextualizes or sharpens the answer
- No CTA begging

### Sample Script 1 — Ask Rachel (Parenting Insights, Teen, ~34s)

**[HOOK | 0–5s | Text card, podcast aesthetic, soft question-mark motif]**
*(Interviewer VO — warm male co-host):* "So Rachel — why do teens shut down the second you ask anything?"

**[RACHEL SETUP | 5–7s | Rachel on camera, beat, half-smile]**

**[RACHEL ANSWERS | 7–28s | Rachel full-frame]**

*(premise)* "Because your question is a test, even when you don't mean it that way."

*(expansion)* "'How was school' isn't a question — it's a performance review. And they fail it every time by answering 'fine,' which makes everyone unhappy."

*(lived example)* "So what I started doing — I stopped asking questions that have a pass/fail answer. 'What was the weirdest thing that happened today.' That has no right answer. They can give me a small thing and it counts."

*(insight)* "It's not that they don't want to talk. It's that they want permission to say something small."

**[PAYOFF | 28–34s]**
"Stop testing them. Start giving them permission. You'd be amazed."

### Sample Script 2 — Ask Rachel (Mom Health, ~30s)

**[HOOK | 0–4s | Text card]**
*(Interviewer VO — curious female peer):* "Rachel — how do you stop the bedtime mental spiral? I cannot turn my brain off."

**[RACHEL SETUP | 4–6s | Rachel, beat, slight exhale]**

**[RACHEL ANSWERS | 6–24s | Rachel]**

*(premise)* "The reason you can't turn it off is because your brain thinks it has to hold everything. And it has good reason — you're the only one holding most of it."

*(lived example)* "What worked for me: a notebook on the nightstand. Not for journaling. For dumping."

"Soccer cleats. Dentist. Birthday gift for my mother-in-law. Whatever. Three to five things, the dumber the better. Then I put the pen down and I'm done."

*(insight)* "Your brain stops holding things once it believes the thing is written down somewhere."

**[PAYOFF | 24–30s]**
"It's not about organizing. It's about permission to let it go for the night."

---

## A5. Moving Images — Instructions

**Target duration:** 30–90s. Sweet spot 40–55s.
**Structure:** Hook slide → 3–5 content slides → CTA slide. No avatar.

**Voiceover (TTS):**
- Female, warm mid-30s, American English
- Distinct from Rachel (Rachel is reserved for on-camera formats)
- Natural pacing, commas as pauses, no broadcast polish
- Approximately 2.5–3 words per second (150–180 wpm)

**Slide design:**
- One idea per slide
- Text overlay on a contrasted panel for readability — never text directly on busy imagery
- Stock photography as background: warm, golden-hour, intimate family moments
- Faces generally avoided — hands, environments, objects preferred
- Never AI-generated images. Real photography only.
- **Backgrounds follow the universal visual sourcing logic in §5.** Default to Tier 2 (licensed stock); Tier 1 (source material) when the signal itself is a visual moment worth showing.

**Narrative arc:**
- Hook slide: scroll-stopping claim or reframe (same hook rules as Avatar Full)
- Content slides (2–4): build the insight with specifics, evidence, or examples
- Second-to-last slide: the "so what" — the actionable takeaway
- CTA slide: soft, save-oriented. "Save this for the next time…"

**When to use:**
- Trending & Culture reactive takes
- Lower-priority Parenting Insights volume
- Content where Rachel's on-camera presence would slow the pace unnecessarily

**When NOT to use:**
- AI Magic (always use Format 3)
- Mom Health (use Avatar Full / Ask Rachel — format needs her voice)
- Personal-story content (needs Rachel's face)

### Sample Script 1 — Moving Images (Trending & Culture, ~45s)

**[SLIDE 1 — HOOK | 0–4s | Warm kitchen photograph, text panel with overlay]**
*On-screen:* **"That viral study about teen screen time — here's what it actually said."**
*(VO):* "That viral study about teen screen time — here's what it actually said."

**[SLIDE 2 | 4–15s | Mother-child photograph, hands holding phone]**
*On-screen:* "The headline — *'two hours is destroying teens'* — isn't wrong. It's incomplete."
*(VO):* "The headline everyone's sharing — 'two hours of phone time is destroying teens' — isn't wrong. It's incomplete."

**[SLIDE 3 | 15–25s | Warm photograph of a teen at a desk, phone nearby]**
*On-screen:* "The damage wasn't from the screen time. It was from what the screen time *replaced*."
*(VO):* "The study found the damage wasn't from the screen time itself. It was from the replacement effect. Every hour on the phone was an hour not sleeping, not moving, not with a friend in person."

**[SLIDE 4 | 25–35s | Outdoor family scene, golden hour]**
*On-screen:* "So the fix isn't *'no phones.'* It's **protect sleep first. In-person time second.**"
*(VO):* "Which means the fix isn't 'no phones.' It's 'protect sleep first, in-person social time second.' Both of those can coexist with screens."

**[SLIDE 5 — CTA | 35–45s | Soft warm background, text overlay]**
*On-screen:* "The conversation isn't *'put the phone down.'* It's *'are you sleeping, are you seeing people.'*"
"— Save this for the next time someone shares the headline."
*(VO):* "The conversation in your house isn't 'put the phone down.' It's 'are you sleeping, are you seeing people.' Save this for the next time someone shares that headline."

### Sample Script 2 — Moving Images (Parenting Insights, Little Kid, ~40s)

**[SLIDE 1 — HOOK | 0–4s | Close-up photograph of a 4-year-old's hands]**
*On-screen:* **"Your 4-year-old isn't lying. Their brain literally can't separate what happened from what they wished happened."**
*(VO):* "Your 4-year-old isn't lying. Their brain literally can't separate what happened from what they wished happened."

**[SLIDE 2 | 4–16s | Child at play, warm light]**
*On-screen:* "Until around age 7, kids don't fully distinguish memory from imagination."
*(VO):* "Until around age 7, kids don't fully distinguish memory from imagination. When your 4-year-old tells you something that isn't true, they often aren't making it up. They remember it that way."

**[SLIDE 3 | 16–26s | Parent-child moment, hands]**
*On-screen:* "This is why *'are you telling the truth?'* doesn't work at 4. The question assumes a skill they don't have yet."
*(VO):* "This is why 'are you telling the truth?' doesn't work with a 4-year-old. The question assumes a cognitive skill they don't have yet."

**[SLIDE 4 | 26–34s | Warm home photograph, kitchen table]**
*On-screen:* "What works: **'walk me through what happened.' 'Is this a remembering or a pretending?'**"
*(VO):* "What works: 'walk me through what happened' — slows them down, gets them in sequence. 'Is this a remembering or a pretending?' — gives them language that isn't about failing."

**[SLIDE 5 — CTA | 34–40s | Soft background]**
*On-screen:* "They're not lying. They're still building the software."
"— Save for the next 4-year-old story you don't quite believe."
*(VO):* "They're not lying. They're still building the software. Save this for the next 4-year-old story you don't quite believe."

---

*End of brief. Questions welcome. Please read both prerequisite docs carefully before scoping — Rachel's character and the brand motivation are load-bearing for every decision above.*
