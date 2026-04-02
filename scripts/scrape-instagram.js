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

async function scrapeInstagramProfile(username) {
  console.log(`Scraping Instagram profile: @${username}...`);

  // Use apify/instagram-profile-scraper for profile data
  const profileRun = await client.actor('apify/instagram-profile-scraper').call({
    usernames: [username],
  });

  const profileData = await client.dataset(profileRun.defaultDatasetId).listItems();
  const profile = profileData.items[0];

  if (!profile) {
    console.error('No profile data returned');
    process.exit(1);
  }

  // Use apify/instagram-post-scraper for recent posts
  console.log('Scraping recent posts...');
  const postsRun = await client.actor('apify/instagram-post-scraper').call({
    username: [username],
    resultsLimit: 30,
  });

  const postsData = await client.dataset(postsRun.defaultDatasetId).listItems();
  const posts = postsData.items;

  // Calculate metrics
  const totalLikes = posts.reduce((sum, p) => sum + (p.likesCount || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.commentsCount || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const avgEngagement = profile.followersCount
    ? (((avgLikes + avgComments) / profile.followersCount) * 100).toFixed(2)
    : 0;

  // Top 5 posts by engagement
  const topPosts = [...posts]
    .sort((a, b) => ((b.likesCount || 0) + (b.commentsCount || 0)) - ((a.likesCount || 0) + (a.commentsCount || 0)))
    .slice(0, 5)
    .map(p => ({
      url: p.url,
      caption: (p.caption || '').slice(0, 150),
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      type: p.type,
      timestamp: p.timestamp,
    }));

  // Posting frequency
  const sortedByDate = [...posts].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let postsPerWeek = 0;
  if (sortedByDate.length >= 2) {
    const firstDate = new Date(sortedByDate[0].timestamp);
    const lastDate = new Date(sortedByDate[sortedByDate.length - 1].timestamp);
    const weeks = (lastDate - firstDate) / (7 * 24 * 60 * 60 * 1000);
    postsPerWeek = weeks > 0 ? (posts.length / weeks).toFixed(1) : posts.length;
  }

  const result = {
    platform: 'instagram',
    username: profile.username,
    scrapedAt: new Date().toISOString(),
    profile: {
      fullName: profile.fullName,
      bio: profile.biography,
      followersCount: profile.followersCount,
      followingCount: profile.followsCount,
      postsCount: profile.postsCount,
      isVerified: profile.verified,
      profilePicUrl: profile.profilePicUrlHD || profile.profilePicUrl,
      externalUrl: profile.externalUrl,
    },
    engagement: {
      avgLikes,
      avgComments,
      avgEngagementRate: `${avgEngagement}%`,
      totalPostsAnalyzed: posts.length,
    },
    postingFrequency: {
      postsPerWeek: Number(postsPerWeek),
      totalPostsInSample: posts.length,
    },
    topPosts,
    recentPosts: posts.slice(0, 10).map(p => ({
      url: p.url,
      caption: (p.caption || '').slice(0, 100),
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      type: p.type,
      timestamp: p.timestamp,
    })),
  };

  const outPath = resolve(__dirname, '../data/instagram-baseline.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Instagram data saved to ${outPath}`);
  return result;
}

const data = await scrapeInstagramProfile('thesecretmomstribe');
console.log('\n=== INSTAGRAM BASELINE ===');
console.log(`Followers: ${data.profile.followersCount}`);
console.log(`Posts: ${data.profile.postsCount}`);
console.log(`Bio: ${data.profile.bio}`);
console.log(`Avg Likes: ${data.engagement.avgLikes}`);
console.log(`Avg Comments: ${data.engagement.avgComments}`);
console.log(`Engagement Rate: ${data.engagement.avgEngagementRate}`);
console.log(`Posts/Week: ${data.postingFrequency.postsPerWeek}`);
console.log('\nTop 5 Posts:');
data.topPosts.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.likes} likes, ${p.comments} comments — ${p.caption}...`);
});
