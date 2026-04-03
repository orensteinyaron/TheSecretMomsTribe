import { useState, useEffect, useCallback } from 'react';
import TabBar from './components/TabBar';
import ContentCard from './components/ContentCard';
import CostDashboard from './components/CostDashboard';
import { fetchContent } from './api';

const TABS_WITH_COSTS = ['review', 'approved', 'bank', 'rejected', 'costs'];

export default function App() {
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  const loadAll = useCallback(async (activeTab) => {
    setLoading(true);
    try {
      // Fetch current tab data + all tabs for counts in parallel
      const [current, review, allApproved, rejected] = await Promise.all([
        fetchContent(activeTab),
        fetchContent('review'),
        fetchContent('approved').then(d => d).catch(() => []),
        fetchContent('rejected'),
      ]);
      const bank = await fetchContent('bank').catch(() => []);

      setItems(current);
      setCounts({
        review: review.length,
        approved: allApproved.length,
        bank: bank.length,
        rejected: rejected.length,
      });
    } catch (err) {
      console.error('Fetch failed:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll(tab);
  }, [tab, loadAll]);

  const refresh = async () => {
    setSpinning(true);
    await loadAll(tab);
    setTimeout(() => setSpinning(false), 600);
  };

  const handleTabChange = (newTab) => {
    setTab(newTab);
  };

  return (
    <>
      <div className="app-header">
        <div className="app-title">SMT Content Pipeline</div>
        <div className="app-subtitle">@thesecretmomstribe</div>
      </div>

      <TabBar
        active={tab}
        counts={counts}
        onChange={handleTabChange}
      />

      {/* Bank counter */}
      {tab === 'bank' && !loading && (
        <div className="bank-counter">
          <div className="bank-stat">
            <div className="bank-stat-value">{items.length}</div>
            <div className="bank-stat-label">Total</div>
          </div>
          <div className="bank-stat">
            <div className="bank-stat-value">{items.filter(i => i.platform === 'instagram').length}</div>
            <div className="bank-stat-label">Instagram</div>
          </div>
          <div className="bank-stat">
            <div className="bank-stat-value">{items.filter(i => i.platform === 'tiktok').length}</div>
            <div className="bank-stat-label">TikTok</div>
          </div>
        </div>
      )}

      {/* Cost dashboard */}
      {tab === 'costs' ? (
        <CostDashboard />
      ) : loading ? (
        <div className="loading">Loading...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          {tab === 'review' && 'No posts to review'}
          {tab === 'approved' && 'No approved posts waiting for images'}
          {tab === 'bank' && 'Launch bank is empty'}
          {tab === 'rejected' && 'No rejected posts'}
        </div>
      ) : (
        <div className="card-list">
          {items.map(item => (
            <ContentCard key={item.id} item={item} tab={tab} onRefresh={refresh} />
          ))}
        </div>
      )}

      {/* Refresh button */}
      <button className={`refresh-btn ${spinning ? 'spinning' : ''}`} onClick={refresh}>
        ↻
      </button>
    </>
  );
}
