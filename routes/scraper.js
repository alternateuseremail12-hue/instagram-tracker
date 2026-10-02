const express = require('express');
const router = express.Router();
const scraper = require('../scraper/engine');
const { restartScheduler } = require('../scraper/scheduler');
const { getDatabase } = require('../database/schema');

// GET scraper status
router.get('/status', (req, res) => {
    const db = getDatabase();
    try {
        const status = scraper.getStatus();
        const settings = {};
        const rows = db.prepare(`SELECT key, value FROM app_settings`).all();
        rows.forEach(r => settings[r.key] = r.value);

        const recentLogs = db.prepare(`
            SELECT sl.*, c.username
            FROM scrape_log sl
            JOIN creators c ON c.id = sl.creator_id
            ORDER BY sl.started_at DESC
            LIMIT 20
        `).all();

        res.json({ ...status, settings, recentLogs });
    } finally {
        db.close();
    }
});

// POST trigger manual scrape for a specific creator
router.post('/scrape/:creatorId', async (req, res) => {
    try {
        res.json({ message: 'Scrape started', status: 'running' });
        // Run asynchronously
        scraper.scrapeCreator(req.params.creatorId).catch(err => {
            console.error('Manual scrape error:', err.message);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST trigger full scrape cycle
router.post('/scrape-all', async (req, res) => {
    if (scraper.isRunning) {
        return res.status(409).json({ error: 'Scraper is already running' });
    }
    res.json({ message: 'Full scrape cycle started', status: 'running' });
    scraper.scrapeAll().catch(err => {
        console.error('Full scrape error:', err.message);
    });
});

// PUT update settings
router.put('/settings', (req, res) => {
    const db = getDatabase();
    try {
        const { scrape_interval_minutes, download_media, max_posts_per_scrape } = req.body;

        if (scrape_interval_minutes !== undefined) {
            db.prepare(`UPDATE app_settings SET value = ? WHERE key = 'scrape_interval_minutes'`).run(String(scrape_interval_minutes));
        }
        if (download_media !== undefined) {
            db.prepare(`UPDATE app_settings SET value = ? WHERE key = 'download_media'`).run(String(download_media));
        }
        if (max_posts_per_scrape !== undefined) {
            db.prepare(`UPDATE app_settings SET value = ? WHERE key = 'max_posts_per_scrape'`).run(String(max_posts_per_scrape));
        }

        // Restart scheduler with new interval
        if (scrape_interval_minutes !== undefined) {
            restartScheduler();
        }

        res.json({ success: true });
    } finally {
        db.close();
    }
});

module.exports = router;
