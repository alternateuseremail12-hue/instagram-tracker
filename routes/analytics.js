const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/schema');

// ──────────────────────────────────────────────────────────
// HELPER: DATE FILTERING
// ──────────────────────────────────────────────────────────
function getDateFilter(req, col = 'ci.publish_date') {
    let sql = '';
    let params = [];
    if (req.query && req.query.startDate) {
        sql += ` AND ${col} >= ?`;
        params.push(req.query.startDate);
    }
    if (req.query && req.query.endDate) {
        sql += ` AND ${col} <= ?`;
        // Appending 'z' ensures lexicographical coverage of the entire end date
        params.push(req.query.endDate + 'z');
    }
    return { sql, params };
}

// ──────────────────────────────────────────────────────────
// CREATOR ANALYTICS
// ──────────────────────────────────────────────────────────

// GET creator summary (Step 9)
router.get('/creator/:id/summary', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const creator = db.prepare(`SELECT * FROM creators WHERE id = ?`).get(req.params.id);
        if (!creator) return res.status(404).json({ error: 'Creator not found' });

        const latest = db.prepare(`SELECT * FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1`).get(req.params.id);
        const oldest = db.prepare(`SELECT * FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured ASC LIMIT 1`).get(req.params.id);

        const allContent = db.prepare(`
            SELECT ci.*,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments,
                   (SELECT views FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as views
            FROM content_items ci
            WHERE ci.creator_id = ? ${df.sql}
            ORDER BY ci.publish_date DESC
        `).all(req.params.id, ...df.params);

        const totalLikes = allContent.reduce((sum, c) => sum + (c.likes || 0), 0);
        const totalComments = allContent.reduce((sum, c) => sum + (c.comments || 0), 0);
        const avgLikes = allContent.length ? totalLikes / allContent.length : 0;
        const avgComments = allContent.length ? totalComments / allContent.length : 0;

        const followers = latest ? latest.followers : 0;
        const avgEngagement = followers > 0 && allContent.length > 0
            ? ((avgLikes + avgComments) / followers) * 100
            : 0;

        // Follower growth
        const followerGrowth = (latest && oldest && oldest.followers > 0)
            ? ((latest.followers - oldest.followers) / oldest.followers) * 100
            : 0;

        // Best/worst posts
        const sorted = [...allContent].sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)));
        const bestPost = sorted[0] || null;
        const worstPost = sorted[sorted.length - 1] || null;

        // Posting frequency (recent posts is typically last 30 days, but if filtered, reflect filter length?)
        // Let's stick to last 30 days as a static stat or allContent if it's filtered
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const dfHasDates = req.query.startDate || req.query.endDate;
        const recentPosts = dfHasDates ? allContent : allContent.filter(c => c.publish_date >= thirtyDaysAgo);
        const postsPerMonth = recentPosts.length;

        // Best hashtag
        const hashtagStats = getHashtagStats(db, req.params.id, df);
        const bestHashtag = hashtagStats.length > 0 ? hashtagStats[0] : null;
        const mostUsed = [...hashtagStats].sort((a, b) => b.times_used - a.times_used)[0] || null;

        // Best posting day/hour
        const schedule = getPostingSchedule(db, req.params.id, df);

        // Latest post
        const latestPost = allContent[0] || null;

        res.json({
            username: creator.username,
            display_name: creator.display_name,
            total_followers: followers,
            average_engagement: Math.round(avgEngagement * 100) / 100,
            average_likes: Math.round(avgLikes),
            average_comments: Math.round(avgComments),
            follower_growth: Math.round(followerGrowth * 100) / 100,
            posting_frequency: postsPerMonth,
            best_performing_post: bestPost,
            worst_performing_post: worstPost,
            best_performing_hashtag: bestHashtag ? bestHashtag.tag : null,
            most_used_hashtag: mostUsed ? mostUsed.tag : null,
            best_posting_day: schedule.bestDay,
            best_posting_hour: schedule.bestHour,
            average_posts_per_month: postsPerMonth,
            latest_post_performance: latestPost ? {
                likes: latestPost.likes,
                comments: latestPost.comments,
                engagement: followers > 0 ? Math.round(((latestPost.likes + latestPost.comments) / followers) * 10000) / 100 : 0
            } : null,
            total_content: allContent.length
        });
    } finally {
        db.close();
    }
});

// GET follower growth chart data
router.get('/creator/:id/follower-growth', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'date_captured');
        const snapshots = db.prepare(`
            SELECT followers, date_captured FROM profile_snapshots
            WHERE creator_id = ? ${df.sql}
            ORDER BY date_captured ASC
        `).all(req.params.id, ...df.params);
        res.json(snapshots);
    } finally {
        db.close();
    }
});

// GET engagement over time
router.get('/creator/:id/engagement-timeline', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const data = db.prepare(`
            SELECT ci.publish_date, ci.content_type,
                   es.likes, es.comments, es.views, es.date_collected
            FROM content_items ci
            JOIN engagement_snapshots es ON es.content_id = ci.id
            WHERE ci.creator_id = ? ${df.sql}
            ORDER BY ci.publish_date ASC
        `).all(req.params.id, ...df.params);
        res.json(data);
    } finally {
        db.close();
    }
});

// GET content ranked (Step 3)
router.get('/creator/:id/content-ranked', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const sortBy = req.query.sort || 'engagement'; // engagement, likes, comments, newest, oldest
        const latestFollowers = db.prepare(`
            SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);
        const followers = latestFollowers ? latestFollowers.followers : 1;

        let content = db.prepare(`
            SELECT ci.*,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments,
                   (SELECT views FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as views
            FROM content_items ci
            WHERE ci.creator_id = ? ${df.sql}
        `).all(req.params.id, ...df.params);

        content = content.map(c => ({
            ...c,
            total_interactions: (c.likes || 0) + (c.comments || 0),
            engagement_rate: followers > 0 ? Math.round((((c.likes || 0) + (c.comments || 0)) / followers) * 10000) / 100 : 0,
            likes_per_follower: followers > 0 ? Math.round(((c.likes || 0) / followers) * 10000) / 100 : 0,
            comments_per_follower: followers > 0 ? Math.round(((c.comments || 0) / followers) * 10000) / 100 : 0
        }));

        switch (sortBy) {
            case 'likes': content.sort((a, b) => b.likes - a.likes); break;
            case 'comments': content.sort((a, b) => b.comments - a.comments); break;
            case 'newest': content.sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')); break;
            case 'oldest': content.sort((a, b) => (a.publish_date || '').localeCompare(b.publish_date || '')); break;
            default: content.sort((a, b) => b.engagement_rate - a.engagement_rate);
        }

        res.json(content);
    } finally {
        db.close();
    }
});

// GET high vs low performing posts (Step 4)
router.get('/creator/:id/performance-comparison', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const latestFollowers = db.prepare(`
            SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);
        const followers = latestFollowers ? latestFollowers.followers : 1;

        let content = db.prepare(`
            SELECT ci.*,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
            FROM content_items ci
            WHERE ci.creator_id = ? ${df.sql}
        `).all(req.params.id, ...df.params);

        if (content.length < 5) {
            return res.json({ message: 'Not enough content for comparison', top: [], middle: [], bottom: [] });
        }

        content = content.map(c => {
            const hashtags = db.prepare(`
                SELECT h.tag FROM content_hashtags ch JOIN hashtags h ON h.id = ch.hashtag_id WHERE ch.content_id = ?
            `).all(c.id);
            const mentions = db.prepare(`SELECT mentioned_username FROM mentions WHERE content_id = ?`).all(c.id);
            return {
                ...c,
                engagement_rate: followers > 0 ? ((c.likes || 0) + (c.comments || 0)) / followers * 100 : 0,
                hashtag_count: hashtags.length,
                caption_length: (c.caption || '').length,
                mention_count: mentions.length,
                publish_hour: c.publish_time ? parseInt(c.publish_time.split(':')[0]) : null,
                publish_day: c.publish_date ? new Date(c.publish_date).getDay() : null
            };
        });

        content.sort((a, b) => b.engagement_rate - a.engagement_rate);
        const topIdx = Math.ceil(content.length * 0.2);
        const bottomIdx = Math.ceil(content.length * 0.8);

        const top = content.slice(0, topIdx);
        const middle = content.slice(topIdx, bottomIdx);
        const bottom = content.slice(bottomIdx);

        const avg = (arr, key) => {
            const vals = arr.map(a => a[key]).filter(v => v !== null && v !== undefined);
            return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        };

        const computeGroupStats = (group) => ({
            count: group.length,
            avg_likes: Math.round(avg(group, 'likes')),
            avg_comments: Math.round(avg(group, 'comments')),
            avg_engagement: Math.round(avg(group, 'engagement_rate') * 100) / 100,
            avg_hashtag_count: Math.round(avg(group, 'hashtag_count') * 10) / 10,
            avg_caption_length: Math.round(avg(group, 'caption_length')),
            avg_mention_count: Math.round(avg(group, 'mention_count') * 10) / 10,
            avg_posting_hour: Math.round(avg(group, 'publish_hour')),
            content_types: group.reduce((acc, c) => { acc[c.content_type] = (acc[c.content_type] || 0) + 1; return acc; }, {})
        });

        res.json({
            top_20: computeGroupStats(top),
            middle_60: computeGroupStats(middle),
            bottom_20: computeGroupStats(bottom)
        });
    } finally {
        db.close();
    }
});

// GET hashtag performance (Step 5)
router.get('/creator/:id/hashtag-performance', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const stats = getHashtagStats(db, req.params.id, df);
        res.json(stats);
    } finally {
        db.close();
    }
});

// GET posting schedule analysis (Step 6)
router.get('/creator/:id/posting-schedule', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const schedule = getPostingSchedule(db, req.params.id, df);
        res.json(schedule);
    } finally {
        db.close();
    }
});

// GET content type comparison (Step 7)
router.get('/creator/:id/content-types', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const types = ['image', 'carousel', 'video', 'reel'];
        const result = {};

        const latestFollowers = db.prepare(`
            SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);
        const followers = latestFollowers ? latestFollowers.followers : 1;

        for (const type of types) {
            const items = db.prepare(`
                SELECT ci.*,
                       (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                       (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
                FROM content_items ci
                WHERE ci.creator_id = ? AND ci.content_type = ? ${df.sql}
            `).all(req.params.id, type, ...df.params);

            const totalLikes = items.reduce((s, c) => s + (c.likes || 0), 0);
            const totalComments = items.reduce((s, c) => s + (c.comments || 0), 0);

            result[type] = {
                count: items.length,
                avg_likes: items.length ? Math.round(totalLikes / items.length) : 0,
                avg_comments: items.length ? Math.round(totalComments / items.length) : 0,
                avg_engagement: items.length && followers > 0
                    ? Math.round(((totalLikes + totalComments) / items.length / followers) * 10000) / 100
                    : 0
            };
        }
        res.json(result);
    } finally {
        db.close();
    }
});

// GET caption analysis (Step 8)
router.get('/creator/:id/caption-analysis', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const content = db.prepare(`
            SELECT ci.caption, ci.id,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
            FROM content_items ci
            WHERE ci.creator_id = ? ${df.sql}
        `).all(req.params.id, ...df.params);

        const latestFollowers = db.prepare(`
            SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);
        const followers = latestFollowers ? latestFollowers.followers : 1;

        const stats = content.map(c => {
            const caption = c.caption || '';
            const hashtagCount = (caption.match(/#\w+/g) || []).length;
            const mentionCount = (caption.match(/@\w+/g) || []).length;
            const emojiCount = (caption.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length;
            return {
                caption_length: caption.length,
                hashtag_count: hashtagCount,
                mention_count: mentionCount,
                emoji_count: emojiCount,
                engagement: followers > 0 ? ((c.likes || 0) + (c.comments || 0)) / followers * 100 : 0
            };
        });

        const avg = (key) => stats.length ? stats.reduce((s, c) => s + c[key], 0) / stats.length : 0;

        // Group by hashtag count ranges
        const hashtagBuckets = {};
        stats.forEach(s => {
            const bucket = s.hashtag_count <= 3 ? '0-3' : s.hashtag_count <= 6 ? '4-6' : s.hashtag_count <= 12 ? '7-12' : '13+';
            if (!hashtagBuckets[bucket]) hashtagBuckets[bucket] = { count: 0, totalEngagement: 0 };
            hashtagBuckets[bucket].count++;
            hashtagBuckets[bucket].totalEngagement += s.engagement;
        });

        Object.keys(hashtagBuckets).forEach(k => {
            hashtagBuckets[k].avg_engagement = Math.round((hashtagBuckets[k].totalEngagement / hashtagBuckets[k].count) * 100) / 100;
        });

        res.json({
            average_caption_length: Math.round(avg('caption_length')),
            average_hashtags: Math.round(avg('hashtag_count') * 10) / 10,
            average_mentions: Math.round(avg('mention_count') * 10) / 10,
            average_emojis: Math.round(avg('emoji_count') * 10) / 10,
            hashtag_engagement_buckets: hashtagBuckets,
            total_posts_analyzed: stats.length
        });
    } finally {
        db.close();
    }
});

// GET opportunity detection (Step 11)
router.get('/creator/:id/opportunities', (req, res) => {
    const db = getDatabase();
    try {
        const df = getDateFilter(req, 'ci.publish_date');
        const opportunities = [];
        const latestFollowers = db.prepare(`
            SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
        `).get(req.params.id);
        const followers = latestFollowers ? latestFollowers.followers : 1;

        // Get all content with engagement
        const content = db.prepare(`
            SELECT ci.*,
                   (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                   (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
            FROM content_items ci
            WHERE ci.creator_id = ? ${df.sql}
            ORDER BY ci.publish_date DESC
        `).all(req.params.id, ...df.params);

        if (content.length < 3) {
            return res.json([{ type: 'info', message: 'Not enough content for opportunity detection in this date range. At least 3 posts needed.' }]);
        }

        // Content type comparison
        const typeGroups = {};
        content.forEach(c => {
            if (!typeGroups[c.content_type]) typeGroups[c.content_type] = [];
            typeGroups[c.content_type].push(((c.likes || 0) + (c.comments || 0)) / (followers > 0 ? followers : 1) * 100);
        });

        const typeAvgs = {};
        Object.entries(typeGroups).forEach(([type, engagements]) => {
            typeAvgs[type] = engagements.reduce((s, v) => s + v, 0) / engagements.length;
        });

        const sortedTypes = Object.entries(typeAvgs).sort((a, b) => b[1] - a[1]);
        if (sortedTypes.length > 1) {
            const best = sortedTypes[0];
            const worst = sortedTypes[sortedTypes.length - 1];
            if (best[1] > worst[1] * 1.3) {
                opportunities.push({
                    type: 'content_type',
                    priority: 'high',
                    message: `${best[0].charAt(0).toUpperCase() + best[0].slice(1)}s consistently outperform ${worst[0]}s (${Math.round(best[1] * 100) / 100}% vs ${Math.round(worst[1] * 100) / 100}% avg engagement).`
                });
            }
        }

        // Check engagement decline
        if (content.length >= 5) {
            const lastFive = content.slice(0, 5);
            const prevFive = content.slice(5, 10);
            if (prevFive.length >= 3) {
                const lastAvg = lastFive.reduce((s, c) => s + (c.likes || 0) + (c.comments || 0), 0) / lastFive.length;
                const prevAvg = prevFive.reduce((s, c) => s + (c.likes || 0) + (c.comments || 0), 0) / prevFive.length;
                if (lastAvg < prevAvg * 0.8) {
                    opportunities.push({
                        type: 'engagement_decline',
                        priority: 'warning',
                        message: `Engagement has declined over the last 5 posts in this range (avg ${Math.round(lastAvg)} vs ${Math.round(prevAvg)} interactions).`
                    });
                }
            }
        }

        // Check posting frequency
        if (content.length >= 2) {
            const latest = new Date(content[0].publish_date);
            const now = new Date();
            const daysSinceLast = (now - latest) / (1000 * 60 * 60 * 24);
            if (daysSinceLast > 14) {
                opportunities.push({
                    type: 'inactivity',
                    priority: 'warning',
                    message: `The creator had not posted for more than ${Math.round(daysSinceLast)} days as of their last post in this range.`
                });
            }
        }

        // Posting day analysis
        const dayGroups = {};
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        content.forEach(c => {
            if (!c.publish_date) return;
            const day = new Date(c.publish_date).getDay();
            if (!dayGroups[day]) dayGroups[day] = [];
            dayGroups[day].push(((c.likes || 0) + (c.comments || 0)) / (followers > 0 ? followers : 1) * 100);
        });

        const dayAvgs = Object.entries(dayGroups)
            .map(([day, engs]) => ({ day: parseInt(day), avg: engs.reduce((s, v) => s + v, 0) / engs.length, count: engs.length }))
            .filter(d => d.count >= 2)
            .sort((a, b) => b.avg - a.avg);

        if (dayAvgs.length > 1 && dayAvgs[0].avg > dayAvgs[dayAvgs.length - 1].avg * 1.3) {
            opportunities.push({
                type: 'posting_day',
                priority: 'insight',
                message: `${dayNames[dayAvgs[0].day]} posts perform ${Math.round((dayAvgs[0].avg / dayAvgs[dayAvgs.length - 1].avg - 1) * 100)}% better than ${dayNames[dayAvgs[dayAvgs.length - 1].day]} posts.`
            });
        }

        // Hashtag opportunities
        const hashtagStats = getHashtagStats(db, req.params.id, df);
        const avgEngAll = hashtagStats.length ? hashtagStats.reduce((s, h) => s + h.avg_engagement, 0) / hashtagStats.length : 0;
        hashtagStats.forEach(h => {
            if (h.avg_engagement > avgEngAll * 1.5 && h.times_used <= 3) {
                opportunities.push({
                    type: 'hashtag',
                    priority: 'insight',
                    message: `#${h.tag} consistently produces above-average engagement (${Math.round(h.avg_engagement * 100) / 100}%) but is rarely used (${h.times_used} times).`
                });
            }
        });

        // Hashtag count analysis
        const captionAnalysis = content.map(c => ({
            hashtags: ((c.caption || '').match(/#\w+/g) || []).length,
            engagement: ((c.likes || 0) + (c.comments || 0)) / (followers > 0 ? followers : 1) * 100
        }));

        const lowHashtag = captionAnalysis.filter(c => c.hashtags >= 3 && c.hashtags <= 6);
        const highHashtag = captionAnalysis.filter(c => c.hashtags > 12);
        if (lowHashtag.length >= 3 && highHashtag.length >= 3) {
            const lowAvg = lowHashtag.reduce((s, c) => s + c.engagement, 0) / lowHashtag.length;
            const highAvg = highHashtag.reduce((s, c) => s + c.engagement, 0) / highHashtag.length;
            if (lowAvg > highAvg * 1.2) {
                opportunities.push({
                    type: 'hashtag_count',
                    priority: 'insight',
                    message: `Posts using 3–6 hashtags average higher engagement (${Math.round(lowAvg * 100) / 100}%) than posts using 12+ hashtags (${Math.round(highAvg * 100) / 100}%).`
                });
            }
        }

        res.json(opportunities);
    } finally {
        db.close();
    }
});


// ──────────────────────────────────────────────────────────
// MASTER LIST ANALYTICS (Step 10)
// ──────────────────────────────────────────────────────────

router.get('/master-list/:id/comparison', (req, res) => {
    const db = getDatabase();
    try {
        const dfPub = getDateFilter(req, 'ci.publish_date');
        const dfCap = getDateFilter(req, 'date_captured');
        const creators = db.prepare(`SELECT * FROM creators WHERE master_list_id = ?`).all(req.params.id);
        if (creators.length === 0) return res.json({ creators: [], highlights: {} });

        const creatorStats = creators.map(c => {
            const latest = db.prepare(`SELECT * FROM profile_snapshots WHERE creator_id = ? ${dfCap.sql} ORDER BY date_captured DESC LIMIT 1`).get(c.id, ...dfCap.params);
            const oldest = db.prepare(`SELECT * FROM profile_snapshots WHERE creator_id = ? ${dfCap.sql} ORDER BY date_captured ASC LIMIT 1`).get(c.id, ...dfCap.params);

            const allContent = db.prepare(`
                SELECT ci.*,
                       (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                       (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
                FROM content_items ci
                WHERE ci.creator_id = ? ${dfPub.sql}
            `).all(c.id, ...dfPub.params);

            const totalPosts = allContent.length;
            const totalReels = allContent.filter(ci => ci.content_type === 'reel').length;

            const totalLikes = allContent.reduce((sum, ci) => sum + (ci.likes || 0), 0);
            const totalComments = allContent.reduce((sum, ci) => sum + (ci.comments || 0), 0);
            const avgLikes = totalPosts ? totalLikes / totalPosts : 0;
            const avgComments = totalPosts ? totalComments / totalPosts : 0;

            const followersForEng = latest ? latest.followers : 1;
            const avgEng = (followersForEng > 0 && totalPosts > 0) ? ((avgLikes + avgComments) / followersForEng) * 100 : 0;

            const followerGrowth = (latest && oldest && oldest.followers > 0)
                ? ((latest.followers - oldest.followers) / oldest.followers) * 100
                : 0;

            return {
                id: c.id,
                username: c.username,
                display_name: c.display_name,
                followers: latest ? latest.followers : 0,
                following: latest ? latest.following : 0,
                avg_engagement: Math.round(avgEng * 100) / 100,
                avg_likes: Math.round(avgLikes),
                avg_comments: Math.round(avgComments),
                total_posts: totalPosts,
                total_reels: totalReels,
                posting_frequency: totalPosts,
                follower_growth: Math.round(followerGrowth * 100) / 100
            };
        });

        // Find highlights
        const mostActive = [...creatorStats].sort((a, b) => b.posting_frequency - a.posting_frequency)[0];
        const fastestGrowing = [...creatorStats].sort((a, b) => b.follower_growth - a.follower_growth)[0];
        const highestEngagement = [...creatorStats].sort((a, b) => b.avg_engagement - a.avg_engagement)[0];

        res.json({
            creators: creatorStats,
            highlights: {
                most_active: mostActive && mostActive.posting_frequency > 0 ? { username: mostActive.username, posting_frequency: mostActive.posting_frequency } : null,
                fastest_growing: fastestGrowing ? { username: fastestGrowing.username, follower_growth: fastestGrowing.follower_growth } : null,
                highest_engagement: highestEngagement && highestEngagement.avg_engagement > 0 ? { username: highestEngagement.username, avg_engagement: highestEngagement.avg_engagement } : null
            },
            total_creators: creatorStats.length,
            combined_followers: creatorStats.reduce((s, c) => s + c.followers, 0),
            avg_engagement: creatorStats.length ? Math.round(creatorStats.reduce((s, c) => s + c.avg_engagement, 0) / creatorStats.length * 100) / 100 : 0
        });
    } finally {
        db.close();
    }
});

// GET dashboard stats for a master list
router.get('/master-list/:id/dashboard', (req, res) => {
    const db = getDatabase();
    try {
        const dfPub = getDateFilter(req, 'ci.publish_date');
        const dfCap = getDateFilter(req, 'date_captured');
        const list = db.prepare(`SELECT * FROM master_lists WHERE id = ?`).get(req.params.id);
        if (!list) return res.status(404).json({ error: 'Master list not found' });

        const creators = db.prepare(`SELECT * FROM creators WHERE master_list_id = ?`).all(req.params.id);

        let combinedFollowers = 0;
        let totalEngagement = 0;
        let validCreatorsForEngagement = 0;
        let postsThisPeriod = 0;
        let reelsThisPeriod = 0;

        creators.forEach(c => {
            const snap = db.prepare(`SELECT * FROM profile_snapshots WHERE creator_id = ? ${dfCap.sql} ORDER BY date_captured DESC LIMIT 1`).get(c.id, ...dfCap.params);
            if (snap) {
                combinedFollowers += snap.followers;
            }

            const allContent = db.prepare(`
                SELECT ci.*,
                       (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
                       (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
                FROM content_items ci
                WHERE ci.creator_id = ? ${dfPub.sql}
            `).all(c.id, ...dfPub.params);

            postsThisPeriod += allContent.length;
            reelsThisPeriod += allContent.filter(ci => ci.content_type === 'reel').length;

            const followersForEng = snap ? snap.followers : 1;
            if (allContent.length > 0 && followersForEng > 0) {
                const cLikes = allContent.reduce((sum, ci) => sum + (ci.likes || 0), 0);
                const cComments = allContent.reduce((sum, ci) => sum + (ci.comments || 0), 0);
                const cAvgEng = ((cLikes / allContent.length + cComments / allContent.length) / followersForEng) * 100;
                totalEngagement += cAvgEng;
                validCreatorsForEngagement++;
            }
        });

        res.json({
            name: list.name,
            total_creators: creators.length,
            combined_followers: combinedFollowers,
            avg_engagement: validCreatorsForEngagement ? Math.round(totalEngagement / validCreatorsForEngagement * 100) / 100 : 0,
            posts_this_week: postsThisPeriod,
            reels_this_week: reelsThisPeriod
        });
    } finally {
        db.close();
    }
});


// ──────────────────────────────────────────────────────────
// CORE HELPER FUNCTIONS FOR STATS
// ──────────────────────────────────────────────────────────

function getHashtagStats(db, creatorId, df = { sql: '', params: [] }) {
    const hashtags = db.prepare(`
        SELECT h.id, h.tag, h.date_first_used, h.date_last_used,
               COUNT(ch.content_id) as times_used
        FROM hashtags h
        JOIN content_hashtags ch ON ch.hashtag_id = h.id
        JOIN content_items ci ON ci.id = ch.content_id
        WHERE ci.creator_id = ? ${df.sql}
        GROUP BY h.id
    `).all(creatorId, ...df.params);

    const latestFollowers = db.prepare(`
        SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
    `).get(creatorId);
    const followers = latestFollowers ? latestFollowers.followers : 1;

    return hashtags.map(h => {
        const posts = db.prepare(`
            SELECT 
                (SELECT likes FROM engagement_snapshots WHERE content_id = ch.content_id ORDER BY date_collected DESC LIMIT 1) as likes,
                (SELECT comments FROM engagement_snapshots WHERE content_id = ch.content_id ORDER BY date_collected DESC LIMIT 1) as comments
            FROM content_hashtags ch
            JOIN content_items ci ON ci.id = ch.content_id
            WHERE ch.hashtag_id = ? AND ci.creator_id = ? ${df.sql}
        `).all(h.id, creatorId, ...df.params);

        const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
        const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
        const avgLikes = posts.length ? totalLikes / posts.length : 0;
        const avgComments = posts.length ? totalComments / posts.length : 0;
        const avgEngagement = followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0;

        return {
            tag: h.tag,
            times_used: h.times_used,
            avg_likes: Math.round(avgLikes),
            avg_comments: Math.round(avgComments),
            avg_engagement: Math.round(avgEngagement * 100) / 100,
            date_first_used: h.date_first_used,
            date_last_used: h.date_last_used
        };
    }).sort((a, b) => b.avg_engagement - a.avg_engagement);
}

function getPostingSchedule(db, creatorId, df = { sql: '', params: [] }) {
    const content = db.prepare(`
        SELECT ci.publish_date, ci.publish_time,
               (SELECT likes FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as likes,
               (SELECT comments FROM engagement_snapshots WHERE content_id = ci.id ORDER BY date_collected DESC LIMIT 1) as comments
        FROM content_items ci
        WHERE ci.creator_id = ? ${df.sql}
    `).all(creatorId, ...df.params);

    const latestFollowers = db.prepare(`
        SELECT followers FROM profile_snapshots WHERE creator_id = ? ORDER BY date_captured DESC LIMIT 1
    `).get(creatorId);
    const followers = latestFollowers ? latestFollowers.followers : 1;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDay = {};
    const byHour = {};

    content.forEach(c => {
        if (c.publish_date) {
            const day = new Date(c.publish_date).getDay();
            if (!byDay[day]) byDay[day] = { posts: 0, totalLikes: 0, totalComments: 0 };
            byDay[day].posts++;
            byDay[day].totalLikes += c.likes || 0;
            byDay[day].totalComments += c.comments || 0;
        }
        if (c.publish_time) {
            const hour = parseInt(c.publish_time.split(':')[0]);
            if (!byHour[hour]) byHour[hour] = { posts: 0, totalLikes: 0, totalComments: 0 };
            byHour[hour].posts++;
            byHour[hour].totalLikes += c.likes || 0;
            byHour[hour].totalComments += c.comments || 0;
        }
    });

    const dayStats = Object.entries(byDay).map(([day, data]) => ({
        day: dayNames[parseInt(day)],
        day_num: parseInt(day),
        posts: data.posts,
        avg_likes: Math.round(data.totalLikes / data.posts),
        avg_comments: Math.round(data.totalComments / data.posts),
        avg_engagement: followers > 0
            ? Math.round(((data.totalLikes + data.totalComments) / data.posts / followers) * 10000) / 100
            : 0
    })).sort((a, b) => b.avg_engagement - a.avg_engagement);

    const hourStats = Object.entries(byHour).map(([hour, data]) => ({
        hour: parseInt(hour),
        hour_label: `${parseInt(hour).toString().padStart(2, '0')}:00`,
        posts: data.posts,
        avg_likes: Math.round(data.totalLikes / data.posts),
        avg_comments: Math.round(data.totalComments / data.posts),
        avg_engagement: followers > 0
            ? Math.round(((data.totalLikes + data.totalComments) / data.posts / followers) * 10000) / 100
            : 0
    })).sort((a, b) => b.avg_engagement - a.avg_engagement);

    return {
        by_day: dayStats,
        by_hour: hourStats,
        bestDay: dayStats[0] ? dayStats[0].day : null,
        worstDay: dayStats[dayStats.length - 1] ? dayStats[dayStats.length - 1].day : null,
        bestHour: hourStats[0] ? hourStats[0].hour_label : null,
        worstHour: hourStats[hourStats.length - 1] ? hourStats[hourStats.length - 1].hour_label : null
    };
}

module.exports = router;
