const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/schema');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const MEDIA_DIR = path.join(__dirname, '..', 'data', 'media');

// Ensure media directories exist
function ensureMediaDirs(username) {
    const dirs = ['profile_pictures', 'images', 'videos', 'reels', 'stories'];
    const basePath = path.join(MEDIA_DIR, username);
    dirs.forEach(d => {
        const p = path.join(basePath, d);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    return basePath;
}

// Download a file from URL
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        if (!url || !url.startsWith('http')) return resolve(null);
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(destPath); });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

// Extract hashtags from caption
function extractHashtags(caption) {
    if (!caption) return [];
    const matches = caption.match(/#(\w+)/g);
    return matches ? matches.map(h => h.substring(1).toLowerCase()) : [];
}

// Extract mentions from caption
function extractMentions(caption) {
    if (!caption) return [];
    const matches = caption.match(/@(\w+)/g);
    return matches ? matches.map(m => m.substring(1).toLowerCase()) : [];
}

class InstagramScraper {
    constructor() {
        this.browser = null;
        this.context = null;
        this.isRunning = false;
        this.currentCreator = null;
        this.log = [];
    }

    async initialize() {
        try {
            this.browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            this.context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 }
            });
            return true;
        } catch (err) {
            console.error('Failed to initialize browser:', err.message);
            return false;
        }
    }

    async close() {
        try {
            if (this.context) await this.context.close();
            if (this.browser) await this.browser.close();
        } catch (err) {
            console.error('Error closing browser:', err.message);
        }
        this.browser = null;
        this.context = null;
    }

    async scrapeCreator(creatorId) {
        const db = getDatabase();
        const logId = uuidv4();
        const startTime = Date.now();

        try {
            const creator = db.prepare(`SELECT * FROM creators WHERE id = ?`).get(creatorId);
            if (!creator) throw new Error('Creator not found');
            if (!creator.tracking_enabled) {
                console.log(`Skipping ${creator.username} - tracking disabled`);
                return { success: true, skipped: true };
            }

            this.currentCreator = creator.username;
            const isFirstScrape = !creator.last_scraped_instagram_id;
            console.log(`🔍 Scraping: ${creator.username} (${isFirstScrape ? 'FIRST scrape' : 'incremental'})`);

            // Log start
            db.prepare(`INSERT INTO scrape_log (id, creator_id, status) VALUES (?, ?, 'running')`)
                .run(logId, creatorId);

            if (!this.browser) {
                const init = await this.initialize();
                if (!init) throw new Error('Failed to initialize browser');
            }

            const page = await this.context.newPage();

            try {
                // Step 1: Open profile page
                await page.goto(creator.instagram_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(2000 + Math.random() * 1000);

                // Check for login wall
                const loginWall = await page.$('input[name="username"]');
                if (loginWall) {
                    console.log('⚠️ Login wall detected. Instagram requires login for this profile.');
                    const notNow = await page.$('text=Not Now');
                    if (notNow) await notNow.click();
                }

                // Step 2: Collect profile statistics
                const profileData = await this.extractProfileData(page, creator);

                // Update creator record
                if (profileData) {
                    const updateFields = [];
                    const updateValues = [];

                    if (profileData.display_name) { updateFields.push('display_name = ?'); updateValues.push(profileData.display_name); }
                    if (profileData.biography) { updateFields.push('biography = ?'); updateValues.push(profileData.biography); }
                    if (profileData.external_website) { updateFields.push('external_website = ?'); updateValues.push(profileData.external_website); }
                    if (profileData.is_verified !== undefined) { updateFields.push('is_verified = ?'); updateValues.push(profileData.is_verified ? 1 : 0); }
                    if (profileData.profile_picture_url) {
                        const mediaDir = ensureMediaDirs(creator.username);
                        const ppPath = path.join(mediaDir, 'profile_pictures', `profile_${Date.now()}.jpg`);
                        try {
                            await downloadFile(profileData.profile_picture_url, ppPath);
                            updateFields.push('profile_picture_path = ?');
                            updateValues.push(ppPath);
                        } catch (e) { }
                    }

                    updateFields.push('last_scraped_date = datetime(\'now\')');
                    updateValues.push(creatorId);

                    if (updateFields.length > 1) {
                        db.prepare(`UPDATE creators SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
                    }

                    // Save profile snapshot
                    db.prepare(`
                        INSERT INTO profile_snapshots (id, creator_id, followers, following, total_posts, total_reels, stories_visible, average_likes, average_comments, engagement_rate)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        uuidv4(), creatorId,
                        profileData.followers || 0,
                        profileData.following || 0,
                        profileData.total_posts || 0,
                        profileData.total_reels || 0,
                        profileData.stories_visible || 0,
                        profileData.average_likes || 0,
                        profileData.average_comments || 0,
                        profileData.engagement_rate || 0
                    );
                }

                // Step 3: Detect and scrape new content (incremental)
                const settings = db.prepare(`SELECT value FROM app_settings WHERE key = 'max_posts_per_scrape'`).get();
                const maxPosts = settings ? parseInt(settings.value) : 12;
                const cursor = creator.last_scraped_instagram_id || null;
                const newPostsFound = await this.scrapeContent(page, db, creator, maxPosts, cursor);

                // Update log
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                db.prepare(`UPDATE scrape_log SET finished_at = datetime('now'), status = 'success', new_posts_found = ? WHERE id = ?`)
                    .run(newPostsFound, logId);

                console.log(`✅ ${creator.username}: ${newPostsFound} new posts | ⏱ ${elapsed}s`);
                return { success: true, newPosts: newPostsFound, elapsed };

            } finally {
                await page.close();
            }

        } catch (err) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.error(`❌ ${this.currentCreator}: ${err.message} | ⏱ ${elapsed}s`);
            db.prepare(`UPDATE scrape_log SET finished_at = datetime('now'), status = 'failed', error_message = ? WHERE id = ?`)
                .run(err.message, logId);
            return { success: false, error: err.message };
        } finally {
            db.close();
        }
    }

    async extractProfileData(page, creator) {
        try {
            const data = {};

            // Try to extract follower/following/post counts from meta or page text
            // Instagram meta description often has "X Followers, Y Following, Z Posts"
            const metaDesc = await page.$eval('meta[property="og:description"]', el => el.content).catch(() => null);
            if (metaDesc) {
                const followerMatch = metaDesc.match(/([\d,.]+[KMB]?)\s*Followers/i);
                const followingMatch = metaDesc.match(/([\d,.]+[KMB]?)\s*Following/i);
                const postsMatch = metaDesc.match(/([\d,.]+[KMB]?)\s*Posts/i);

                if (followerMatch) data.followers = this.parseCount(followerMatch[1]);
                if (followingMatch) data.following = this.parseCount(followingMatch[1]);
                if (postsMatch) data.total_posts = this.parseCount(postsMatch[1]);
            }

            // Try to get from page content as fallback
            if (!data.followers) {
                const statsText = await page.$$eval('header section ul li span', els =>
                    els.map(e => e.textContent || e.title || '')
                ).catch(() => []);

                for (const text of statsText) {
                    const num = this.parseCount(text);
                    if (!data.total_posts && text.toLowerCase().includes('post')) data.total_posts = num;
                    else if (!data.followers && text.toLowerCase().includes('follower')) data.followers = num;
                    else if (!data.following && text.toLowerCase().includes('following')) data.following = num;
                }
            }

            // Alternative: try reading stat values directly
            if (!data.followers) {
                try {
                    const stats = await page.$$eval('a[href*="/followers"] span, a[href*="/following"] span, span[title]', els =>
                        els.map(e => ({ text: e.textContent, title: e.title }))
                    );
                    for (const s of stats) {
                        const val = this.parseCount(s.title || s.text);
                        if (val > 0 && !data.followers) data.followers = val;
                    }
                } catch (e) { }
            }

            // Display name
            data.display_name = await page.$eval('header section h2, header h1, header h2', el => el.textContent?.trim()).catch(() => creator.username);

            // Biography
            data.biography = await page.$eval('header section div.-vDIg span, div[data-testid="user-bio"] span, header section > div > span', el => el.textContent?.trim()).catch(() => '');

            // Profile picture
            data.profile_picture_url = await page.$eval('header img[alt*="profile"], header img[data-testid="user-avatar"]', el => el.src).catch(() => null);

            // Verified
            data.is_verified = await page.$('svg[aria-label="Verified"]').then(el => !!el).catch(() => false);

            // External website
            data.external_website = await page.$eval('a[rel="me nofollow noopener noreferrer"]', el => el.href).catch(() => '');

            // Calculate engagement rate if we have follower data
            if (data.followers > 0) {
                data.engagement_rate = 0; // Will be calculated from content
            }

            return data;
        } catch (err) {
            console.error('Error extracting profile data:', err.message);
            return null;
        }
    }

    async scrapeContent(page, db, creator, maxPosts, cursor) {
        let newPostsFound = 0;
        const isFirstScrape = !cursor;

        try {
            // On FIRST scrape: scroll to load ALL historical posts
            // On subsequent scrapes: just use what's already visible (new posts appear at top)
            if (isFirstScrape) {
                console.log(`  📜 First scrape — scrolling to load all historical posts...`);
                let previousCount = 0;
                let scrollAttempts = 0;
                const MAX_SCROLLS = 50; // Safety cap (~600+ posts)
                let stableCount = 0;

                while (scrollAttempts < MAX_SCROLLS) {
                    const currentCount = await page.$$eval(
                        'article a[href*="/p/"], main a[href*="/p/"], a[href*="/reel/"]',
                        els => els.length
                    ).catch(() => 0);

                    if (currentCount === previousCount) {
                        stableCount++;
                        if (stableCount >= 3) {
                            console.log(`  ✅ Finished scrolling — ${currentCount} posts loaded`);
                            break;
                        }
                    } else {
                        stableCount = 0;
                        if (scrollAttempts % 5 === 0) {
                            console.log(`  📜 Scrolling... ${currentCount} posts loaded so far`);
                        }
                    }
                    previousCount = currentCount;

                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    await page.waitForTimeout(1500 + Math.random() * 1000);
                    scrollAttempts++;
                }
            }

            // Collect all post links from the page
            const postLinks = await page.$$eval(
                'article a[href*="/p/"], main a[href*="/p/"], a[href*="/reel/"]',
                els => {
                    // Deduplicate by href
                    const seen = new Set();
                    return els.filter(el => {
                        if (seen.has(el.href)) return false;
                        seen.add(el.href);
                        return true;
                    }).map(el => ({
                        href: el.href,
                        isReel: el.href.includes('/reel/')
                    }));
                }
            ).catch(() => []);

            console.log(`  Found ${postLinks.length} unique content links`);

            const downloadMediaSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'download_media'`).get();
            const shouldDownload = downloadMediaSetting ? downloadMediaSetting.value === 'true' : true;
            const mediaBasePath = ensureMediaDirs(creator.username);

            // Track the newest post shortcode to save as cursor after this scrape
            let newestShortcode = null;
            let scraped = 0;
            // On first scrape, no per-scrape cap; on subsequent, use maxPosts
            const effectiveMax = isFirstScrape ? Infinity : maxPosts;

            for (const link of postLinks) {
                if (scraped >= effectiveMax) break;

                // Extract post shortcode as ID
                const shortcodeMatch = link.href.match(/\/(p|reel)\/([^/]+)/);
                if (!shortcodeMatch) continue;
                const shortcode = shortcodeMatch[2];

                // Remember the very first (newest) shortcode for the cursor
                if (!newestShortcode) newestShortcode = shortcode;

                // INCREMENTAL STOP: if this post matches where we left off, stop.
                // Everything at or after this point was already scraped.
                if (cursor && shortcode === cursor) {
                    console.log(`  ⏩ Hit cursor (${shortcode}) — stopping, all remaining posts already scraped`);
                    break;
                }

                // Also skip if we somehow already have this post (handles edge cases)
                const existingContent = db.prepare(`SELECT id FROM content_items WHERE instagram_id = ? AND creator_id = ?`).get(shortcode, creator.id);
                if (existingContent) {
                    console.log(`  ⏩ Post ${shortcode} already in DB, skipping`);
                    continue;
                }

                // Scrape new content
                try {
                    const contentData = await this.scrapePost(page, link.href, link.isReel);
                    if (contentData) {
                        const contentId = uuidv4();
                        const contentType = link.isReel ? 'reel' : contentData.content_type || 'image';

                        // Save media
                        let downloadPath = '';
                        if (shouldDownload && contentData.media_url) {
                            const ext = contentType === 'video' || contentType === 'reel' ? 'mp4' : 'jpg';
                            const folder = contentType === 'reel' ? 'reels' : contentType === 'video' ? 'videos' : 'images';
                            downloadPath = path.join(mediaBasePath, folder, `${shortcode}.${ext}`);
                            try {
                                await downloadFile(contentData.media_url, downloadPath);
                            } catch (e) {
                                downloadPath = '';
                            }
                        }

                        // Insert content
                        db.prepare(`
                            INSERT INTO content_items (id, creator_id, instagram_id, url, caption, publish_date, publish_time, content_type, num_media_items, download_location)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            contentId, creator.id, shortcode, link.href,
                            contentData.caption || '',
                            contentData.publish_date || '',
                            contentData.publish_time || '',
                            contentType,
                            contentData.num_media_items || 1,
                            downloadPath
                        );

                        // Save engagement snapshot
                        db.prepare(`
                            INSERT INTO engagement_snapshots (id, content_id, likes, comments, views)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(uuidv4(), contentId, contentData.likes || 0, contentData.comments || 0, contentData.views || 0);

                        // Process hashtags
                        const hashtags = extractHashtags(contentData.caption);
                        for (const tag of hashtags) {
                            let hashtagRow = db.prepare(`SELECT id FROM hashtags WHERE tag = ?`).get(tag);
                            if (!hashtagRow) {
                                const hashtagId = uuidv4();
                                db.prepare(`INSERT INTO hashtags (id, tag) VALUES (?, ?)`).run(hashtagId, tag);
                                hashtagRow = { id: hashtagId };
                            } else {
                                db.prepare(`UPDATE hashtags SET date_last_used = datetime('now') WHERE id = ?`).run(hashtagRow.id);
                            }
                            db.prepare(`INSERT OR IGNORE INTO content_hashtags (content_id, hashtag_id) VALUES (?, ?)`).run(contentId, hashtagRow.id);
                        }

                        // Process mentions
                        const mentions = extractMentions(contentData.caption);
                        for (const mention of mentions) {
                            db.prepare(`INSERT INTO mentions (id, content_id, mentioned_username) VALUES (?, ?, ?)`)
                                .run(uuidv4(), contentId, mention);
                        }

                        newPostsFound++;
                        scraped++;

                        if (scraped % 10 === 0) {
                            console.log(`  📊 Progress: ${scraped} posts scraped so far...`);
                        }
                    }
                } catch (err) {
                    console.error(`  Error scraping post ${shortcode}:`, err.message);
                }

                // Reduced delay between posts
                await page.waitForTimeout(1000 + Math.random() * 1500);
            }

            // Update the cursor to the newest post we saw on the page
            if (newestShortcode) {
                db.prepare(`UPDATE creators SET last_scraped_instagram_id = ? WHERE id = ?`)
                    .run(newestShortcode, creator.id);
            }

        } catch (err) {
            console.error('Error in content scraping:', err.message);
        }

        return newPostsFound;
    }


    async scrapePost(page, postUrl, isReel) {
        const postPage = await this.context.newPage();
        try {
            await postPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await postPage.waitForTimeout(2000 + Math.random() * 1500);

            const data = {};

            // Caption
            data.caption = await postPage.$eval(
                'div[data-testid="post-comment-root"] span, article span[dir="auto"], ul li span[dir="auto"]',
                el => el.textContent?.trim()
            ).catch(() => '');

            // Likes
            const likesText = await postPage.$eval(
                'a[href*="/liked_by/"] span, section span[class*="like"], button[class*="like"] span',
                el => el.textContent
            ).catch(() => '0');
            data.likes = this.parseCount(likesText);

            // Comments count
            const commentsText = await postPage.$$eval(
                'ul > li[role="menuitem"]',
                els => els.length
            ).catch(() => 0);
            data.comments = commentsText > 0 ? commentsText - 1 : 0; // Subtract caption

            // Views (for videos/reels)
            if (isReel) {
                const viewsText = await postPage.$eval(
                    'span[class*="view"], div[class*="view"] span',
                    el => el.textContent
                ).catch(() => '0');
                data.views = this.parseCount(viewsText);
            }

            // Publish date/time
            const timeEl = await postPage.$eval('time[datetime]', el => el.getAttribute('datetime')).catch(() => null);
            if (timeEl) {
                const dt = new Date(timeEl);
                data.publish_date = dt.toISOString().split('T')[0];
                data.publish_time = dt.toTimeString().split(' ')[0].substring(0, 5);
            }

            // Content type detection
            const hasVideo = await postPage.$('video').catch(() => null);
            const carouselDots = await postPage.$$('div[class*="carousel"] button, div[role="presentation"] button').catch(() => []);

            if (isReel || hasVideo) {
                data.content_type = isReel ? 'reel' : 'video';
            } else if (carouselDots.length > 0) {
                data.content_type = 'carousel';
                data.num_media_items = carouselDots.length;
            } else {
                data.content_type = 'image';
            }

            // Media URL
            data.media_url = await postPage.$eval('video source, video', el => el.src).catch(
                () => postPage.$eval('article img[src*="instagram"], div[role="presentation"] img', el => el.src).catch(() => null)
            );

            return data;
        } catch (err) {
            console.error(`  Error in scrapePost:`, err.message);
            return null;
        } finally {
            await postPage.close();
        }
    }

    async updateEngagement(page, db, postUrl, contentId) {
        const postPage = await this.context.newPage();
        try {
            await postPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await postPage.waitForTimeout(2000);

            const likesText = await postPage.$eval(
                'a[href*="/liked_by/"] span, section span[class*="like"]',
                el => el.textContent
            ).catch(() => '0');
            const likes = this.parseCount(likesText);

            const commentsCount = await postPage.$$eval('ul > li[role="menuitem"]', els => els.length).catch(() => 0);
            const comments = commentsCount > 0 ? commentsCount - 1 : 0;

            const viewsText = await postPage.$eval('span[class*="view"]', el => el.textContent).catch(() => '0');
            const views = this.parseCount(viewsText);

            db.prepare(`INSERT INTO engagement_snapshots (id, content_id, likes, comments, views) VALUES (?, ?, ?, ?, ?)`)
                .run(uuidv4(), contentId, likes, comments, views);

        } catch (err) {
            // Silently fail for engagement updates
        } finally {
            await postPage.close();
        }
    }

    parseCount(text) {
        if (!text) return 0;
        text = text.toString().trim().replace(/,/g, '');
        const match = text.match(/([\d.]+)\s*([KMBkmb])?/);
        if (!match) return 0;
        let num = parseFloat(match[1]);
        const suffix = (match[2] || '').toUpperCase();
        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;
        return Math.round(num);
    }

    // Scrape all creators across all master lists
    async scrapeAll() {
        if (this.isRunning) {
            console.log('⚠️ Scraper is already running');
            return;
        }

        this.isRunning = true;
        const db = getDatabase();

        try {
            db.prepare(`UPDATE app_settings SET value = 'running' WHERE key = 'scraper_status'`).run();

            const creators = db.prepare(`
                SELECT c.* FROM creators c
                JOIN master_lists ml ON ml.id = c.master_list_id
                WHERE c.tracking_enabled = 1
                ORDER BY c.last_scraped_date ASC NULLS FIRST
            `).all();

            console.log(`\n🚀 Starting scrape cycle: ${creators.length} creators to process`);
            const cycleStart = Date.now();

            await this.initialize();

            for (const creator of creators) {
                try {
                    await this.scrapeCreator(creator.id);
                    // Reduced delay between creators
                    await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
                } catch (err) {
                    console.error(`Failed to scrape ${creator.username}:`, err.message);
                }
            }

            await this.close();
            const cycleElapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
            console.log(`✅ Scrape cycle complete | Total: ${cycleElapsed}s for ${creators.length} creators\n`);

        } catch (err) {
            console.error('Scrape cycle error:', err.message);
        } finally {
            this.isRunning = false;
            try {
                const db2 = getDatabase();
                db2.prepare(`UPDATE app_settings SET value = 'idle' WHERE key = 'scraper_status'`).run();
                db2.close();
            } catch (e) { }
            db.close();
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            currentCreator: this.currentCreator
        };
    }
}

module.exports = new InstagramScraper();
