# Moving Images — QA Rules

## Automated Checks (qa-agent.ts)

### Technical
| Check | Pass Criteria |
|-------|---------------|
| Resolution | Exactly 1080x1920 |
| Audio track | Must exist (unless --no-audio) |
| Duration | Within 10% of expected (word count / 2.6 WPS) |
| Frame orientation | All sample frames portrait |
| Frame brightness | Average pixel 40-240 |

### Content
| Check | Pass Criteria |
|-------|---------------|
| Silence gaps | Max 2 gaps > 0.8s mid-video |
| Words per second | 2.0-4.0 (ideal: 2.6) |
| Watermark | Bottom-right corner has non-zero content |

### Vision Review (Claude)
| Dimension | Min Score (1-10) |
|-----------|-----------------|
| Scroll stop power | 6 |
| Visual variety | 6 |
| Text readability | 7 |
| Visual coherence | 6 |
| Professional quality | 7 |
| Image relevance | 6 |

### Anti-AI Checklist
- Visual variety across slides (not same photo repeated)
- No em dashes in captions
- Duration under 65 seconds
- No generic hooks ("In today's world...")

## Pass/Fail
- **PASS:** overall score >= 7 AND would_post = true
- **FAIL:** overall < 7 OR would_post = false
- Exit code: 0 = pass, 1 = fail
