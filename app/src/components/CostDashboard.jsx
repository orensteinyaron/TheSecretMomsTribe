import { useState, useEffect } from 'react';
import { fetchCosts } from '../api';

export default function CostDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCosts()
      .then(setData)
      .catch(err => console.error('Cost fetch failed:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading costs...</div>;
  if (!data?.daily?.length) return <div className="empty-state">No cost data yet</div>;

  const rows = data.daily;
  const today = new Date().toISOString().split('T')[0];

  // Today's costs
  const todayRows = rows.filter(r => r.created_at?.startsWith(today));
  const todayTotal = todayRows.reduce((s, r) => s + parseFloat(r.cost_usd || 0), 0);

  // By stage
  const byStage = {};
  todayRows.forEach(r => {
    const stage = r.pipeline_stage || 'other';
    byStage[stage] = (byStage[stage] || 0) + parseFloat(r.cost_usd || 0);
  });

  // 7-day trend
  const dailyTotals = {};
  rows.forEach(r => {
    const day = r.created_at?.split('T')[0];
    if (day) dailyTotals[day] = (dailyTotals[day] || 0) + parseFloat(r.cost_usd || 0);
  });

  const days = Object.keys(dailyTotals).sort().slice(-7);
  const maxDay = Math.max(...days.map(d => dailyTotals[d]), 0.01);

  return (
    <div className="cost-section">
      <div className="cost-header">Cost Dashboard</div>

      {/* Today's total */}
      <div className="cost-card">
        <div className="card-label">Today</div>
        <div className="cost-total">${todayTotal.toFixed(4)}</div>
      </div>

      {/* By stage */}
      {Object.keys(byStage).length > 0 && (
        <div className="cost-card">
          <div className="card-label" style={{ marginBottom: 8 }}>By Stage (Today)</div>
          <div className="cost-breakdown">
            {Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([stage, cost]) => (
              <div className="cost-row" key={stage}>
                <span className="cost-row-label">{stage.replace(/_/g, ' ')}</span>
                <span className="cost-row-value">${cost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7-day trend */}
      {days.length > 1 && (
        <div className="cost-card">
          <div className="card-label" style={{ marginBottom: 8 }}>7-Day Trend</div>
          <div className="cost-bar-container">
            {days.map(day => (
              <div
                key={day}
                className="cost-bar"
                style={{ height: `${(dailyTotals[day] / maxDay) * 100}%` }}
              >
                <span className="cost-bar-label">{day.slice(5)}</span>
              </div>
            ))}
          </div>
          <div style={{ height: 24 }} />
        </div>
      )}
    </div>
  );
}
