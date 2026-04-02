import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '../data');

function loadJSON(filename) {
  const path = resolve(dataDir, filename);
  if (!existsSync(path)) {
    console.error(`Missing ${path} — run the scrapers first`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const ig = loadJSON('instagram-baseline.json');
const tt = loadJSON('tiktok-baseline.json');

if (!ig && !tt) {
  console.error('No data files found. Run scrape-instagram.js and scrape-tiktok.js first.');
  process.exit(1);
}

let report = `# SMT Baseline Social Report
Generated: ${new Date().toISOString().split('T')[0]}

---

`;

if (ig) {
  report += `## Instagram — @${ig.username}

| Metric | Value |
|---|---|
| Followers | ${ig.profile.followersCount?.toLocaleString() || 'N/A'} |
| Following | ${ig.profile.followingCount?.toLocaleString() || 'N/A'} |
| Total Posts | ${ig.profile.postsCount?.toLocaleString() || 'N/A'} |
| Bio | ${ig.profile.bio || 'N/A'} |
| Verified | ${ig.profile.isVerified ? 'Yes' : 'No'} |
| External URL | ${ig.profile.externalUrl || 'None'} |

### Engagement (last ${ig.engagement.totalPostsAnalyzed} posts)
| Metric | Value |
|---|---|
| Avg Likes | ${ig.engagement.avgLikes?.toLocaleString()} |
| Avg Comments | ${ig.engagement.avgComments?.toLocaleString()} |
| Engagement Rate | ${ig.engagement.avgEngagementRate} |
| Posts/Week | ${ig.postingFrequency.postsPerWeek} |

### Top 5 Posts
${ig.topPosts.map((p, i) => `${i + 1}. **${p.likes} likes, ${p.comments} comments** — ${p.caption}...
   ${p.url}`).join('\n')}

---

`;
}

if (tt) {
  report += `## TikTok — @${tt.username}

| Metric | Value |
|---|---|
| Followers | ${tt.profile.followersCount?.toLocaleString() || 'N/A'} |
| Following | ${tt.profile.followingCount?.toLocaleString() || 'N/A'} |
| Total Videos | ${tt.profile.videoCount?.toLocaleString() || 'N/A'} |
| Total Likes | ${tt.profile.totalLikes?.toLocaleString() || 'N/A'} |
| Bio | ${tt.profile.bio || 'N/A'} |

### Engagement (last ${tt.engagement.totalPostsAnalyzed} posts)
| Metric | Value |
|---|---|
| Avg Views | ${tt.engagement.avgViews?.toLocaleString()} |
| Avg Likes | ${tt.engagement.avgLikes?.toLocaleString()} |
| Avg Comments | ${tt.engagement.avgComments?.toLocaleString()} |
| Avg Shares | ${tt.engagement.avgShares?.toLocaleString()} |
| Engagement Rate | ${tt.engagement.avgEngagementRate} |
| Posts/Week | ${tt.postingFrequency.postsPerWeek} |

### Top 5 Posts
${tt.topPosts.map((p, i) => `${i + 1}. **${p.views?.toLocaleString()} views, ${p.likes?.toLocaleString()} likes** — ${p.text}...
   ${p.url}`).join('\n')}

---

`;
}

report += `## Key Takeaways

*To be filled after data is collected.*

---

## Next Steps

1. Set content cadence targets based on current posting frequency
2. Identify content gaps vs. top performers in niche
3. Begin Research Agent daily briefings
4. Set engagement rate improvement goals
`;

const outPath = resolve(dataDir, 'baseline-report.md');
writeFileSync(outPath, report);
console.log(`Baseline report saved to ${outPath}`);
console.log('\n' + report);
