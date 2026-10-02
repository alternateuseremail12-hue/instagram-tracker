const cron = require('node-cron');
const scraper = require('./engine');
const { getDatabase } = require('../database/schema');

let scheduledTask = null;

function getInterval() {
    try {
        const db = getDatabase();
        const setting = db.prepare(`SELECT value FROM app_settings WHERE key = 'scrape_interval_minutes'`).get();
        db.close();
        return setting ? parseInt(setting.value) : 60;
    } catch {
        return 60;
    }
}

function startScheduler() {
    const intervalMinutes = getInterval();
    console.log(`⏰ Background scheduler: every ${intervalMinutes} minutes`);

    // Run every N minutes
    const cronExpression = `*/${intervalMinutes} * * * *`;

    if (scheduledTask) {
        scheduledTask.stop();
    }

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log(`\n⏰ Scheduled scrape triggered at ${new Date().toLocaleString()}`);
        try {
            await scraper.scrapeAll();
        } catch (err) {
            console.error('Scheduled scrape failed:', err.message);
        }
    }, {
        scheduled: true
    });

    console.log('✅ Scheduler started');
}

function stopScheduler() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('⏹ Scheduler stopped');
    }
}

function restartScheduler() {
    stopScheduler();
    startScheduler();
}

module.exports = { startScheduler, stopScheduler, restartScheduler };
