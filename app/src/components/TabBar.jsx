const TABS = [
  { id: 'review', label: 'Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'bank', label: 'Bank' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'costs', label: '$' },
];

export default function TabBar({ active, counts, onChange }) {
  return (
    <div className="tab-bar">
      {TABS.map(tab => (
        <div
          key={tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {counts[tab.id] != null && (
            <span className="tab-count">{counts[tab.id]}</span>
          )}
        </div>
      ))}
    </div>
  );
}
