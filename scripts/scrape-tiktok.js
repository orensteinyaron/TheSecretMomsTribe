import { ApifyClient } from 'apify-client';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN environment variable');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

async function scrapeTikTokProfile(username) {
  console.log(`Scraping TikTok profile: @${username}...`);

  // Use clockworks/free-tiktok-scraper for profile + posts
  const run = await client.actor('clockworks/free-tiktok-scraper').call({
    profiles: [username],
    resultsPerPage: 30,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });

  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  const items = dataset.items;

  // Separate profile info from posts
  const profileItem = items.find(i => i.type === 'user' || i.authorMeta);
  const posts = items.filter(i => i.type === 'video' || i.videoMeta || i.text);

  // Extract profile data
  const authorMeta = profileItem?.authorMeta || posts[0]?.authorMeta || {};
  const followersCount = authorMeta.fans || authorMeta.followers || 0;
  const followingCount = authorMeta.following || 0;
  const likesCount = authorMeta.heart || authorMeta.likes || 0;
  const videoCount = authorMeta.video || authorMeta.videoCount || posts.length;
  const bio = authorMeta.signature || authorMeta.bio || '';
  const nickname = authorMeta.nickName || authorMeta.name || username;

  // Calculate engagement
  const totalViews = posts.reduce((sum, p) => sum + (p.playCount || p.videoMeta?.playCount || 0), 0);
  const totalLikes = posts.reduce((sum, p) => sum + (p.diggCount || p.likes || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.commentCount || p.comments || 0), 0);
  const totalShares = posts.reduce((sum, p) => sum + (p.shareCount || p.shares || 0), 0);
  const avgViews = posts.length ? Math.round(totalViews / posts.length) : 0;
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : 0;

  const avgEngagement = avgViews > 0
    ? (((avgLikes + avgComments + avgShares) / avgViews) * 100).toFixed(2)
    : '0';

  // Top 5 posts
  const topPosts = [...posts]
    .sort((a, b) => ((b.playCount || 0) + (b.diggCount || 0)) - ((a.playCount || 0) + (a.diggCount || 0)))
    .slice(0, 5)
    .map(p => ({
      url: p.webVideoUrl || `https://www.tiktok.com/@${username}/video/${p.id}`,
      text: (p.text || '').slice(0, 150),
      views: p.playCount || 0,
      likes: p.diggCount || 0,
      comments: p.commentCount || 0,
      shares: p.shareCount || 0,
      createTime: p.createTimeISO || p.createTime,
    }));

  // Posting frequency
  const sortedByDate = [...posts]
    .filter(p => p.createTimeISO || p.createTime)
    .sort((a, b) => new Date(a.createTimeISO || a.createTime * 1000) - new Date(b.createTimeISO || b.createTime * 1000));
  let postsPerWeek = 0;
  if (sortedByDate.length >= 2) {
    const firstDate = new Date(sortedByDate[0].createTimeISO || sortedByDate[0].createTime * 1000);
    const lastDate = new Date(sortedByDate[sortedByDate.length - 1].createTimeISO || sortedByDate[sortedByDate.length - 1].createTime * 1000);
    const weeks = (lastDate - firstDate) / (7 * 24 * 60 * 60 * 1000);
    postsPerWeek = weeks > 0 ? (posts.length / weeks).toFixed(1) : posts.length;
  }

  const result = {
    platform: 'tiktok',
    username,
    scrapedAt: new Date().toISOString(),
    profile: {
      nickname,
      bio,
      followersCount,
      followingCount,
      totalLikes: likesCount,
      videoCount,
    },
    engagement: {
      avgViews,
      avgLikes,
      avgComments,
      avgShares,
      avgEngagementRate: `${avgEngagement}%`,
      totalPostsAnalyzed: posts.length,
    },
    postingFrequency: {
      postsPerWeek: Number(postsPerWeek),
      totalPostsInSample: posts.length,
    },
    topPosts,
    recentPosts: posts.slice(0, 10).map(p => ({
      url: p.webVideoUrl || `https://www.tiktok.com/@${username}/video/${p.id}`,
      text: (p.text || '').slice(0, 100),
      views: p.playCount || 0,
      likes: p.diggCount || 0,
      comments: p.commentCount || 0,
      shares: p.shareCount || 0,
      createTime: p.createTimeISO || p.createTime,
    })),
  };

  const outPath = resolve(__dirname, '../data/tiktok-baseline.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`TikTok data saved to ${outPath}`);
  return result;
}

const data = await scrapeTikTokProfile('secret.moms.tribe');
console.log('\n=== TIKTOK BASELINE ===');
console.log(`Followers: ${data.profile.followersCount}`);
console.log(`Videos: ${data.profile.videoCount}`);
console.log(`Bio: ${data.profile.bio}`);
console.log(`Total Likes: ${data.profile.totalLikes}`);
console.log(`Avg Views: ${data.engagement.avgViews}`);
console.log(`Avg Likes: ${data.engagement.avgLikes}`);
console.log(`Engagement Rate: ${data.engagement.avgEngagementRate}`);
console.log(`Posts/Week: ${data.postingFrequency.postsPerWeek}`);
console.log('\nTop 5 Posts:');
data.topPosts.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.views} views, ${p.likes} likes — ${p.text}...`);
});
