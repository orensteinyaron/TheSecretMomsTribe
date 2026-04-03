import { useState } from 'react';
import { PlatformBadge, PillarBadge, TypeBadge, AgeBadge, FormatBadge, ImageStatusBadge } from './Badge';
import ActionButtons from './ActionButtons';
import { updateContent } from '../api';

export default function ContentCard({ item, tab, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editHook, setEditHook] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setEditHook(item.hook || '');
    setEditCaption(item.caption || '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async (e) => {
    e.stopPropagation();
    setSaving(true);
    try {
      await updateContent(item.id, { hook: editHook, caption: editCaption });
      setEditing(false);
      onRefresh();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action, updates) => {
    if (action === 'edit') {
      startEdit();
      if (!expanded) setExpanded(true);
      return;
    }
    try {
      await updateContent(item.id, updates);
      onRefresh();
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
  };

  const toggle = () => {
    if (!editing) setExpanded(!expanded);
  };

  return (
    <div className={`card ${expanded ? 'card-expanded' : ''}`} onClick={toggle}>
      {/* Header badges */}
      <div className="card-header">
        <PlatformBadge platform={item.platform} />
        <FormatBadge format={item.post_format} />
        <PillarBadge pillar={item.content_pillar} />
        <TypeBadge type={item.content_type} />
        <AgeBadge age={item.age_range} />
        <ImageStatusBadge status={item.image_status} />
      </div>

      {/* Hook */}
      {editing ? (
        <div onClick={e => e.stopPropagation()}>
          <textarea
            className="edit-field hook-edit"
            value={editHook}
            onChange={e => setEditHook(e.target.value)}
            rows={2}
          />
        </div>
      ) : (
        <div className={`card-hook ${!expanded ? 'truncated' : ''}`}>
          {item.hook}
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="card-body">
          {/* Image */}
          {item.image_url && (
            <img className="card-image" src={item.image_url} alt="" loading="lazy" />
          )}

          {/* Slides */}
          {item.slide_images && item.slide_images.length > 0 && (
            <div className="slide-viewer">
              {item.slide_images.map((s, i) => (
                s.image_url && <img key={i} className="slide-thumb" src={s.image_url} alt={`Slide ${s.slide_number}`} loading="lazy" />
              ))}
            </div>
          )}

          {/* AI Magic Output */}
          {item.ai_magic_output && (
            <div className="card-section">
              <span className="card-label">AI Magic Output</span>
              <div className="card-text">{item.ai_magic_output}</div>
            </div>
          )}

          {/* Caption */}
          <div className="card-section">
            <span className="card-label">Caption</span>
            {editing ? (
              <div onClick={e => e.stopPropagation()}>
                <textarea
                  className="edit-field"
                  value={editCaption}
                  onChange={e => setEditCaption(e.target.value)}
                  rows={4}
                />
              </div>
            ) : (
              <div className="card-text">{item.caption}</div>
            )}
          </div>

          {/* Hashtags */}
          {item.hashtags && item.hashtags.length > 0 && (
            <div className="card-section">
              <span className="card-label">Hashtags</span>
              <div className="card-hashtags">
                {item.hashtags.map((h, i) => <span key={i} className="hashtag">{h}</span>)}
              </div>
            </div>
          )}

          {/* Image prompt */}
          {item.image_prompt && (
            <div className="card-section">
              <span className="card-label">Image Prompt</span>
              <div className="card-text" style={{ fontSize: '11px' }}>
                {typeof item.image_prompt === 'string' ? item.image_prompt : JSON.stringify(item.image_prompt, null, 2)}
              </div>
            </div>
          )}

          {/* Audio suggestion */}
          {item.audio_suggestion && (
            <div className="card-section">
              <span className="card-label">Audio</span>
              <div className="card-text">{item.audio_suggestion}</div>
            </div>
          )}

          {/* Rejection reason */}
          {item.rejection_reason && tab === 'rejected' && (
            <div className="card-section">
              <span className="card-label">Rejection Reason</span>
              <div className="card-text" style={{ color: 'var(--btn-reject)' }}>{item.rejection_reason}</div>
            </div>
          )}

          {/* Edit save/cancel */}
          {editing && (
            <div className="edit-actions" onClick={e => e.stopPropagation()}>
              <button className="btn btn-approve" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-secondary" onClick={() => cancelEdit()}>
                Cancel
              </button>
            </div>
          )}

          {/* Action buttons */}
          {!editing && (
            <ActionButtons tab={tab} item={item} onAction={handleAction} />
          )}
        </div>
      )}
    </div>
  );
}
