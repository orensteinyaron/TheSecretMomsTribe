import { useState } from 'react';

export default function ActionButtons({ tab, item, onAction }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const handleReject = () => {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    onAction('reject', { status: 'rejected', rejection_reason: reason || 'No reason given' });
    setRejecting(false);
    setReason('');
  };

  if (rejecting) {
    return (
      <div>
        <input
          className="reject-input"
          placeholder="Rejection reason..."
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
        <div className="card-actions">
          <button className="btn btn-reject" onClick={e => { e.stopPropagation(); handleReject(); }}>
            Confirm
          </button>
          <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); setRejecting(false); setReason(''); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (tab === 'review') {
    return (
      <div className="card-actions">
        <button className="btn btn-approve" onClick={e => { e.stopPropagation(); onAction('approve', { status: 'approved' }); }}>
          Approve
        </button>
        <button className="btn btn-edit" onClick={e => { e.stopPropagation(); onAction('edit'); }}>
          Edit
        </button>
        <button className="btn btn-reject" onClick={e => { e.stopPropagation(); handleReject(); }}>
          Reject
        </button>
      </div>
    );
  }

  if (tab === 'approved') {
    const canBank = item.image_status === 'generated';
    return (
      <div className="card-actions">
        <button
          className="btn btn-bank"
          disabled={!canBank}
          onClick={e => { e.stopPropagation(); onAction('bank', { launch_bank: true }); }}
          title={canBank ? '' : 'Image must be generated first'}
        >
          {canBank ? '→ Bank' : 'Waiting...'}
        </button>
        <button className="btn btn-edit" onClick={e => { e.stopPropagation(); onAction('edit'); }}>
          Edit
        </button>
        <button className="btn btn-reject" onClick={e => { e.stopPropagation(); handleReject(); }}>
          Reject
        </button>
      </div>
    );
  }

  if (tab === 'bank') {
    return (
      <div className="card-actions">
        <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); onAction('unbank', { launch_bank: false }); }}>
          Remove
        </button>
        <button className="btn btn-edit" onClick={e => { e.stopPropagation(); onAction('edit'); }}>
          Edit
        </button>
      </div>
    );
  }

  if (tab === 'rejected') {
    return (
      <div className="card-actions">
        <button className="btn btn-approve" onClick={e => { e.stopPropagation(); onAction('restore', { status: 'draft', rejection_reason: null }); }}>
          Restore
        </button>
      </div>
    );
  }

  return null;
}
