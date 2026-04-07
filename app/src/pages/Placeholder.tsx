import { useLocation } from 'react-router-dom';

export default function Placeholder() {
  const { pathname } = useLocation();
  const name = pathname.split('/').pop() || 'page';
  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-4 capitalize">{name.replace(/-/g, ' ')}</h1>
      <div className="bg-bg-surface border border-border-default rounded-lg p-8 text-center">
        <p className="text-text-secondary">Coming in Phase 2</p>
      </div>
    </div>
  );
}
