// ─── CREATOR DETAIL PAGE ───

// Global date range state for this creator
let _dateRange = { startDate: '', endDate: '' };

function getDateParams() {
    const p = new URLSearchParams();
    if (_dateRange.startDate) p.set('startDate', _dateRange.startDate);
    if (_dateRange.endDate) p.set('endDate', _dateRange.endDate);
    return p.toString() ? '?' + p.toString() : '';
}

function getDateSuffix() {
    const p = getDateParams();
    return p ? '&' + p.substring(1) : '';
}

async function renderCreatorDetail(creatorId) {
    const container = document.getElementById('pageContainer');
    container.innerHTML = '<div class="loading-spinner" style="padding:48px;text-align:center"><div class="spinner"></div> Loading creator...</div>';
    try {
        const creator = await API.get(`/api/creators/${creatorId}`);
        const summary = await API.get(`/api/analytics/creator/${creatorId}/summary`);

        container.innerHTML = `<div class="fade-in">
            <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="display:flex;gap:16px;align-items:center">
                    <div class="creator-avatar" style="width:64px;height:64px;font-size:28px">${(creator.display_name || creator.username)[0].toUpperCase()}</div>
                    <div>
                        <h2 style="margin-bottom:2px">${creator.display_name || creator.username} ${creator.is_verified ? '<span style="color:var(--accent-info)">✓</span>' : ''}</h2>
                        <p style="color:var(--text-muted)">@${creator.username} · ${creator.master_list_name || 'No list'}</p>
                        <p style="font-size:13px;margin-top:4px;max-width:500px">${creator.biography || ''}</p>
                    </div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-secondary btn-sm" onclick="scrapeCreator('${creatorId}')">🔄 Scrape Now</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteCreator('${creatorId}','${creator.master_list_id}')">🗑</button>
                </div>
            </div>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-card-icon purple">👥</div><div class="stat-card-label">Followers</div><div class="stat-card-value">${formatNumber(summary.total_followers)}</div><div class="stat-card-change ${summary.follower_growth >= 0 ? 'positive' : 'negative'}">${summary.follower_growth >= 0 ? '↑' : '↓'} ${Math.abs(summary.follower_growth)}%</div></div>
                <div class="stat-card"><div class="stat-card-icon cyan">📈</div><div class="stat-card-label">Avg Engagement</div><div class="stat-card-value">${summary.average_engagement}%</div></div>
                <div class="stat-card"><div class="stat-card-icon pink">❤️</div><div class="stat-card-label">Avg Likes</div><div class="stat-card-value">${formatNumber(summary.average_likes)}</div></div>
                <div class="stat-card"><div class="stat-card-icon green">💬</div><div class="stat-card-label">Avg Comments</div><div class="stat-card-value">${formatNumber(summary.average_comments)}</div></div>
                <div class="stat-card"><div class="stat-card-icon yellow">📝</div><div class="stat-card-label">Posts/Month</div><div class="stat-card-value">${summary.posting_frequency}</div></div>
                <div class="stat-card"><div class="stat-card-icon blue">📊</div><div class="stat-card-label">Total Content</div><div class="stat-card-value">${summary.total_content}</div></div>
            </div>

            <!-- Date Range Filter -->
            <div class="card" style="margin-bottom:16px;padding:12px 16px">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                    <span style="font-size:13px;font-weight:600;color:var(--text-muted)">📅 Filter by date range:</span>
                    <input type="date" id="dateStart" class="form-input" style="width:auto;padding:6px 10px;font-size:13px" value="${_dateRange.startDate}" />
                    <span style="color:var(--text-dim)">→</span>
                    <input type="date" id="dateEnd" class="form-input" style="width:auto;padding:6px 10px;font-size:13px" value="${_dateRange.endDate}" />
                    <button class="btn btn-secondary btn-sm" onclick="applyDateFilter('${creatorId}')">Apply</button>
                    <button class="btn btn-sm" style="opacity:0.7" onclick="clearDateFilter('${creatorId}')">Clear</button>
                    ${_dateRange.startDate || _dateRange.endDate ? '<span style="font-size:11px;color:var(--accent-primary)">✓ Filter active</span>' : ''}
                </div>
            </div>

            <div class="tabs" id="creatorTabs">
                <button class="tab active" onclick="switchCreatorTab('overview','${creatorId}')">Overview</button>
                <button class="tab" onclick="switchCreatorTab('content','${creatorId}')">Content</button>
                <button class="tab" onclick="switchCreatorTab('hashtags','${creatorId}')">Hashtags</button>
                <button class="tab" onclick="switchCreatorTab('schedule','${creatorId}')">Schedule</button>
                <button class="tab" onclick="switchCreatorTab('insights','${creatorId}')">Insights</button>
            </div>
            <div id="creatorTabContent"></div>
        </div>`;
        switchCreatorTab('overview', creatorId);
    } catch (e) { console.error(e); container.innerHTML = '<div class="empty-state"><h3>Error loading creator</h3></div>'; }
}

function applyDateFilter(creatorId) {
    _dateRange.startDate = document.getElementById('dateStart').value;
    _dateRange.endDate = document.getElementById('dateEnd').value;
    renderCreatorDetail(creatorId);
}

function clearDateFilter(creatorId) {
    _dateRange = { startDate: '', endDate: '' };
    renderCreatorDetail(creatorId);
}

async function switchCreatorTab(tab, creatorId) {
    document.querySelectorAll('#creatorTabs .tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList?.add('active');
    const content = document.getElementById('creatorTabContent');
    destroyCharts();

    if (tab === 'overview') await renderOverviewTab(content, creatorId);
    else if (tab === 'content') await renderContentTab(content, creatorId);
    else if (tab === 'hashtags') await renderHashtagsTab(content, creatorId);
    else if (tab === 'schedule') await renderScheduleTab(content, creatorId);
    else if (tab === 'insights') await renderInsightsTab(content, creatorId);
}

// ─── Helper: chart description block ───
function chartDesc(text) {
    return `<div style="font-size:12px;color:var(--text-dim);padding:4px 0 8px;font-family:monospace;letter-spacing:0.3px"># ${text}</div>`;
}

async function renderOverviewTab(el, id) {
    const dp = getDateParams();
    el.innerHTML = `
        <div class="grid-2" style="margin-bottom:24px">
            <div class="chart-card">
                <div class="card-header"><span class="card-title">Follower Growth</span></div>
                ${chartDesc('tracks follower count over time — each point is a scrape snapshot')}
                <canvas id="followerChart"></canvas>
            </div>
            <div class="chart-card">
                <div class="card-header"><span class="card-title">Engagement Timeline</span></div>
                ${chartDesc('plots (likes + comments) / followers % for each post by publish date')}
                <canvas id="engagementChart"></canvas>
            </div>
        </div>
        <div class="grid-2">
            <div class="chart-card">
                <div class="card-header"><span class="card-title">Content Type Performance</span></div>
                ${chartDesc('compares avg engagement rate across content types — higher bar = better format')}
                <canvas id="contentTypeChart"></canvas>
            </div>
            <div class="card" id="performanceCard">
                <div class="card-header"><span class="card-title">Top vs Bottom 20%</span></div>
                ${chartDesc('splits all posts into top/mid/bottom tiers to find what makes top posts different')}
                <div id="perfComparison"></div>
            </div>
        </div>`;
    try {
        const [growth, contentTypes, perf] = await Promise.all([
            API.get(`/api/analytics/creator/${id}/follower-growth${dp}`),
            API.get(`/api/analytics/creator/${id}/content-types${dp}`),
            API.get(`/api/analytics/creator/${id}/performance-comparison${dp}`)
        ]);
        if (growth.length) {
            createChart('followerChart', { type: 'line', data: { labels: growth.map(g => new Date(g.date_captured).toLocaleDateString()), datasets: [{ label: 'Followers', data: growth.map(g => g.followers), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', fill: true, tension: 0.4, pointRadius: 2 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } } });
        }
        // Content type chart
        const typeLabels = Object.keys(contentTypes).filter(k => contentTypes[k].count > 0);
        const typeColors = { image: '#60a5fa', carousel: '#8b5cf6', video: '#f472b6', reel: '#34d399' };
        if (typeLabels.length) {
            createChart('contentTypeChart', { type: 'bar', data: { labels: typeLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)), datasets: [{ label: 'Avg Engagement %', data: typeLabels.map(l => contentTypes[l].avg_engagement), backgroundColor: typeLabels.map(l => typeColors[l] || '#8b5cf6'), borderRadius: 6 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
        }
        // Performance comparison
        if (perf.top_20) {
            const metrics = ['avg_likes', 'avg_comments', 'avg_engagement', 'avg_hashtag_count', 'avg_caption_length'];
            const labels = ['Avg Likes', 'Avg Comments', 'Avg Engagement', 'Avg Hashtags', 'Avg Caption Len'];
            document.getElementById('perfComparison').innerHTML = metrics.map((m, i) => {
                const t = perf.top_20[m] || 0, mid = perf.middle_60[m] || 0, b = perf.bottom_20[m] || 0;
                const max = Math.max(t, mid, b, 1);
                return `<div class="comparison-bar"><span class="comparison-label">${labels[i]}</span><div class="comparison-track"><div class="comparison-segment segment-top" style="width:${(t / max * 100).toFixed(0)}%">${typeof t === 'number' ? t.toFixed(t < 10 ? 1 : 0) : t}</div><div class="comparison-segment segment-mid" style="width:${(mid / max * 100).toFixed(0)}%">${typeof mid === 'number' ? mid.toFixed(mid < 10 ? 1 : 0) : mid}</div><div class="comparison-segment segment-bottom" style="width:${(b / max * 100).toFixed(0)}%">${typeof b === 'number' ? b.toFixed(b < 10 ? 1 : 0) : b}</div></div></div>`;
            }).join('') + '<div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:var(--text-muted)"><span><span style="display:inline-block;width:10px;height:10px;background:rgba(139,92,246,0.7);border-radius:2px;margin-right:4px"></span>Top 20%</span><span><span style="display:inline-block;width:10px;height:10px;background:rgba(6,182,212,0.4);border-radius:2px;margin-right:4px"></span>Middle 60%</span><span><span style="display:inline-block;width:10px;height:10px;background:rgba(239,68,68,0.4);border-radius:2px;margin-right:4px"></span>Bottom 20%</span></div>';
        }
    } catch (e) { console.error(e); }
}

async function renderContentTab(el, id) {
    el.innerHTML = `<div class="card">
        <div class="card-header">
            <span class="card-title">Content</span>
            <select class="form-input" style="width:auto" onchange="loadContent('${id}',this.value)">
                <option value="engagement">By Engagement</option>
                <option value="likes">By Likes</option>
                <option value="comments">By Comments</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
            </select>
        </div>
        ${chartDesc('all scraped posts ranked by selected metric — click a card to open on instagram')}
        <div id="contentList" class="content-grid"></div>
    </div>`;
    await loadContent(id, 'engagement');
}

async function loadContent(id, sort) {
    const list = document.getElementById('contentList');
    try {
        const content = await API.get(`/api/analytics/creator/${id}/content-ranked?sort=${sort}${getDateSuffix()}`);
        list.innerHTML = content.length ? content.map(c => {
            const caption = c.caption && c.caption.trim()
                ? (c.caption.length > 120 ? c.caption.substring(0, 120) + '…' : c.caption)
                : null;
            const hasData = (c.likes || 0) > 0 || (c.comments || 0) > 0;
            const dimStyle = hasData ? '' : 'opacity:0.45';
            return `
            <div class="content-card" style="cursor:pointer" onclick="window.open('${c.url || '#'}','_blank')" title="Open on Instagram">
                <div class="content-card-body">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <span class="content-type-badge ${c.content_type}">${c.content_type.toUpperCase()}</span>
                        <span style="font-size:12px;color:var(--text-dim)">${c.publish_date || 'Date unknown'}</span>
                    </div>
                    <div class="content-caption" style="${caption ? '' : 'color:var(--text-dim);font-style:italic'}">${caption || 'Caption unavailable'}</div>
                    <div class="content-meta" style="${dimStyle}">
                        <span>❤️ ${formatNumber(c.likes || 0)}</span>
                        <span>💬 ${formatNumber(c.comments || 0)}</span>
                        <span>📊 ${c.engagement_rate}%</span>
                    </div>
                    ${c.url ? '<div style="margin-top:6px;font-size:11px;color:var(--accent-primary)">↗ View on Instagram</div>' : ''}
                </div>
            </div>`;
        }).join('') : '<div class="empty-state"><p>No content found for the selected date range.</p></div>';
    } catch (e) { list.innerHTML = '<p style="color:var(--text-muted)">Error loading content</p>'; }
}

async function renderHashtagsTab(el, id) {
    const dp = getDateParams();
    el.innerHTML = `<div class="grid-2">
        <div class="chart-card">
            <div class="card-header"><span class="card-title">Top Hashtags by Engagement</span></div>
            ${chartDesc('ranks hashtags by avg engagement % — find which tags drive the most interaction')}
            <canvas id="hashtagChart"></canvas>
        </div>
        <div class="card">
            <div class="card-header"><span class="card-title">Hashtag Performance</span></div>
            ${chartDesc('detailed breakdown of each hashtag — usage count, avg likes/comments, and engagement rate')}
            <div class="table-container"><table><thead><tr><th>Hashtag</th><th>Used</th><th>Avg Likes</th><th>Avg Comments</th><th>Avg Eng.</th></tr></thead><tbody id="hashtagTable"></tbody></table></div>
        </div>
    </div>`;
    try {
        const hashtags = await API.get(`/api/analytics/creator/${id}/hashtag-performance${dp}`);
        if (hashtags.length) {
            const top10 = hashtags.slice(0, 10);
            createChart('hashtagChart', { type: 'bar', data: { labels: top10.map(h => '#' + h.tag), datasets: [{ label: 'Avg Engagement %', data: top10.map(h => h.avg_engagement), backgroundColor: 'rgba(139,92,246,0.6)', borderRadius: 6 }] }, options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } } });
            document.getElementById('hashtagTable').innerHTML = hashtags.slice(0, 20).map(h => `<tr><td style="font-weight:600;color:var(--accent-primary)">#${h.tag}</td><td>${h.times_used}</td><td>${formatNumber(h.avg_likes)}</td><td>${formatNumber(h.avg_comments)}</td><td>${h.avg_engagement}%</td></tr>`).join('');
        }
    } catch (e) { console.error(e); }
}

async function renderScheduleTab(el, id) {
    const dp = getDateParams();
    el.innerHTML = `<div class="grid-2" style="margin-bottom:24px">
        <div class="chart-card">
            <div class="card-header"><span class="card-title">Best Posting Days</span></div>
            ${chartDesc('avg engagement by day of week — highlighted bar = best performing day')}
            <canvas id="dayChart"></canvas>
        </div>
        <div class="chart-card">
            <div class="card-header"><span class="card-title">Best Posting Hours</span></div>
            ${chartDesc('avg engagement by hour of day (24h) — find the golden posting window')}
            <canvas id="hourChart"></canvas>
        </div>
    </div>
    <div class="card" id="captionCard">
        <div class="card-header"><span class="card-title">Caption Analysis</span></div>
        ${chartDesc('average caption stats across all posts — length, hashtag count, mentions, emojis')}
        <div id="captionStats"></div>
    </div>`;
    try {
        const [schedule, caption] = await Promise.all([
            API.get(`/api/analytics/creator/${id}/posting-schedule${dp}`),
            API.get(`/api/analytics/creator/${id}/caption-analysis${dp}`)
        ]);
        if (schedule.by_day?.length) {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayData = new Array(7).fill(0);
            schedule.by_day.forEach(d => dayData[d.day_num] = d.avg_engagement);
            createChart('dayChart', { type: 'bar', data: { labels: days, datasets: [{ label: 'Avg Engagement %', data: dayData, backgroundColor: dayData.map((v, i) => i === schedule.by_day[0]?.day_num ? '#8b5cf6' : 'rgba(139,92,246,0.3)'), borderRadius: 6 }] }, options: { responsive: true, plugins: { legend: { display: false } } } });
        }
        if (schedule.by_hour?.length) {
            const hourData = new Array(24).fill(0);
            schedule.by_hour.forEach(h => hourData[h.hour] = h.avg_engagement);
            createChart('hourChart', { type: 'bar', data: { labels: Array.from({ length: 24 }, (_, i) => i + ':00'), datasets: [{ label: 'Avg Engagement %', data: hourData, backgroundColor: 'rgba(6,182,212,0.5)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } } } });
        }
        document.getElementById('captionStats').innerHTML = `<div class="stats-grid" style="margin-bottom:16px">
            <div class="stat-card"><div class="stat-card-label">Avg Caption Length</div><div class="stat-card-value">${caption.average_caption_length}</div></div>
            <div class="stat-card"><div class="stat-card-label">Avg Hashtags</div><div class="stat-card-value">${caption.average_hashtags}</div></div>
            <div class="stat-card"><div class="stat-card-label">Avg Mentions</div><div class="stat-card-value">${caption.average_mentions}</div></div>
            <div class="stat-card"><div class="stat-card-label">Avg Emojis</div><div class="stat-card-value">${caption.average_emojis}</div></div>
        </div>${caption.hashtag_engagement_buckets ? '<h4 style="margin-bottom:8px;font-size:14px">Hashtag Count vs Engagement</h4>' + Object.entries(caption.hashtag_engagement_buckets).map(([k, v]) => `<div class="comparison-bar"><span class="comparison-label">${k} hashtags (${v.count})</span><div class="comparison-track"><div class="comparison-segment segment-top" style="width:${Math.min(v.avg_engagement * 10, 100)}%">${v.avg_engagement}%</div></div></div>`).join('') : ''}`;
    } catch (e) { console.error(e); }
}

async function renderInsightsTab(el, id) {
    const dp = getDateParams();
    el.innerHTML = `<div class="card">
        <div class="card-header"><span class="card-title">🧠 Opportunity Detection</span><span class="card-subtitle">Rule-based insights from historical data</span></div>
        ${chartDesc('auto-detected patterns — content type winners, engagement trends, hashtag opportunities')}
        <div id="insightsList"></div>
    </div>`;
    try {
        const insights = await API.get(`/api/analytics/creator/${id}/opportunities${dp}`);
        const iconMap = { high: '🔥', warning: '⚠️', insight: '💡', info: 'ℹ️' };
        document.getElementById('insightsList').innerHTML = insights.length ? insights.map(i => `
            <div class="insight-card">
                <div class="insight-icon ${i.priority || 'info'}">${iconMap[i.priority] || '💡'}</div>
                <div><div class="insight-type" style="color:var(--text-muted)">${(i.type || '').replace(/_/g, ' ')}</div><div class="insight-text">${i.message}</div></div>
            </div>`).join('') : '<div style="color:var(--text-muted);padding:16px">No insights available yet. More data needed.</div>';
    } catch (e) { console.error(e); }
}

async function scrapeCreator(id) {
    await API.post(`/api/scraper/scrape/${id}`);
    showToast('Scrape started for this creator', 'info');
}

async function deleteCreator(id, listId) {
    if (!confirm('Delete this creator and all tracked data?')) return;
    await API.del(`/api/creators/${id}`);
    showToast('Creator deleted', 'success');
    await loadSidebar();
    if (listId) navigate('list-detail', { id: listId, name: '' });
    else navigate('dashboard');
}
