// ─── SCRAPER CONTROL PAGE ───
async function renderScraperPage() {
    const container = document.getElementById('pageContainer');
    container.innerHTML = `<div class="fade-in">
        <div class="page-header"><h2>Scraper Control</h2><p>Monitor and manage the background scraping engine</p></div>
        <div id="scraperContent"></div>
    </div>`;
    try {
        const status = await API.get('/api/scraper/status');
        document.getElementById('scraperContent').innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-card-icon ${status.isRunning ? 'green' : 'purple'}">
                        ${status.isRunning ? '🔄' : '⏸'}
                    </div>
                    <div class="stat-card-label">Status</div>
                    <div class="stat-card-value" style="font-size:20px">${status.isRunning ? 'Running' : 'Idle'}</div>
                    ${status.isRunning && status.currentCreator ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Scraping @${status.currentCreator}</div>` : ''}
                </div>
                <div class="stat-card">
                    <div class="stat-card-icon cyan">⏰</div>
                    <div class="stat-card-label">Interval</div>
                    <div class="stat-card-value">${status.settings?.scrape_interval_minutes || 60}m</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-icon pink">📸</div>
                    <div class="stat-card-label">Media Download</div>
                    <div class="stat-card-value" style="font-size:20px">${status.settings?.download_media === 'true' ? 'On' : 'Off'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-icon yellow">📝</div>
                    <div class="stat-card-label">Max Posts/Scrape</div>
                    <div class="stat-card-value">${status.settings?.max_posts_per_scrape || 12}</div>
                </div>
            </div>
            <div style="margin-bottom:24px;display:flex;gap:8px">
                <button class="btn btn-primary" onclick="triggerFullScrape()" ${status.isRunning ? 'disabled style="opacity:0.5"' : ''}>
                    🚀 Run Full Scrape
                </button>
                <button class="btn btn-secondary" onclick="renderScraperPage()">↻ Refresh</button>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Recent Scrape Log</span>
                    <span style="font-size:12px;color:var(--text-muted)">${status.recentLogs?.length || 0} entries</span>
                </div>
                ${status.recentLogs?.length ? `
                    <div class="table-container">
                        <table>
                            <thead><tr>
                                <th>Status</th><th>Creator</th><th>Started</th><th>Duration</th><th>New Posts</th><th>Error</th>
                            </tr></thead>
                            <tbody>
                                ${status.recentLogs.map(l => {
            const dur = l.finished_at && l.started_at
                ? Math.round((new Date(l.finished_at) - new Date(l.started_at)) / 1000) + 's'
                : '...';
            return `<tr>
                                        <td><div class="log-status ${l.status}" style="display:inline-block;margin-right:6px"></div>${l.status}</td>
                                        <td style="font-weight:600">@${l.username}</td>
                                        <td>${timeAgo(l.started_at)}</td>
                                        <td>${dur}</td>
                                        <td>${l.new_posts_found || 0}</td>
                                        <td style="color:var(--accent-danger);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${l.error_message || '—'}</td>
                                    </tr>`;
        }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div style="color:var(--text-muted);padding:16px;text-align:center">No scrape activity recorded yet. Add creators and run a scrape to get started.</div>'}
            </div>`;
    } catch (e) { console.error(e); }
}

// ─── SETTINGS PAGE ───
async function renderSettingsPage() {
    const container = document.getElementById('pageContainer');
    try {
        const status = await API.get('/api/scraper/status');
        const settings = status.settings || {};

        container.innerHTML = `<div class="fade-in">
            <div class="page-header"><h2>Settings</h2><p>Configure scraping behavior and application preferences</p></div>
            
            <div class="settings-section">
                <h3>⏰ Scheduling</h3>
                <div class="setting-row">
                    <div class="setting-info">
                        <h4>Scrape Interval</h4>
                        <p>How often the background scraper runs (in minutes)</p>
                    </div>
                    <div class="setting-control">
                        <select class="form-input" style="width:120px" id="settingInterval" onchange="updateSetting('scrape_interval_minutes', this.value)">
                            <option value="15" ${settings.scrape_interval_minutes === '15' ? 'selected' : ''}>15 min</option>
                            <option value="30" ${settings.scrape_interval_minutes === '30' ? 'selected' : ''}>30 min</option>
                            <option value="60" ${settings.scrape_interval_minutes === '60' ? 'selected' : ''}>1 hour</option>
                            <option value="120" ${settings.scrape_interval_minutes === '120' ? 'selected' : ''}>2 hours</option>
                            <option value="360" ${settings.scrape_interval_minutes === '360' ? 'selected' : ''}>6 hours</option>
                            <option value="720" ${settings.scrape_interval_minutes === '720' ? 'selected' : ''}>12 hours</option>
                            <option value="1440" ${settings.scrape_interval_minutes === '1440' ? 'selected' : ''}>24 hours</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <h3>📸 Media</h3>
                <div class="setting-row">
                    <div class="setting-info">
                        <h4>Download Media</h4>
                        <p>Automatically download images, videos, and reels</p>
                    </div>
                    <div class="setting-control">
                        <label class="toggle">
                            <input type="checkbox" ${settings.download_media === 'true' ? 'checked' : ''} onchange="updateSetting('download_media', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-info">
                        <h4>Max Posts Per Scrape</h4>
                        <p>Maximum number of new posts to collect per creator per scrape cycle</p>
                    </div>
                    <div class="setting-control">
                        <select class="form-input" style="width:120px" onchange="updateSetting('max_posts_per_scrape', this.value)">
                            <option value="6" ${settings.max_posts_per_scrape === '6' ? 'selected' : ''}>6</option>
                            <option value="12" ${settings.max_posts_per_scrape === '12' ? 'selected' : ''}>12</option>
                            <option value="24" ${settings.max_posts_per_scrape === '24' ? 'selected' : ''}>24</option>
                            <option value="48" ${settings.max_posts_per_scrape === '48' ? 'selected' : ''}>48</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <h3>ℹ️ About</h3>
                <div style="color:var(--text-secondary);font-size:14px;line-height:1.8">
                    <p><strong>InstaTrack</strong> — Instagram Competitor Intelligence Platform</p>
                    <p>Built with Node.js, Express, SQLite, Playwright, and Chart.js</p>
                    <p style="color:var(--text-muted);font-size:12px;margin-top:8px">Data is stored locally in the <code style="background:var(--bg-input);padding:2px 6px;border-radius:4px">data/</code> directory</p>
                </div>
            </div>
        </div>`;
    } catch (e) { console.error(e); }
}

async function updateSetting(key, value) {
    try {
        await API.put('/api/scraper/settings', { [key]: value });
        showToast('Setting updated', 'success');
    } catch (e) { showToast('Failed to update setting', 'error'); }
}
