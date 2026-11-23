import React, { useEffect, useState } from 'react'
import { Check, Copy, Lock, Plus, Unlock, X } from 'lucide-react'
import { api, type AdminCluster, type SiteEffects } from '../api'

interface Props {
  effects: SiteEffects
  onClose: () => void
  onUpdated: (next: SiteEffects) => void
  onClustersChanged: () => void
}

const DEFAULT_EFFECTS: SiteEffects = {
  allow_author_filter: true,
  gravity_strength: 1.0,
  nebula_opacity: 1.0,
  gate_title: '点亮今夜的星',
  upload_label: '拾光入星',
}

export const AdminPanelModal: React.FC<Props> = ({
  effects,
  onClose,
  onUpdated,
  onClustersChanged,
}) => {
  const [tab, setTab] = useState<'clusters' | 'effects'>('clusters')
  const [clusters, setClusters] = useState<AdminCluster[]>([])
  const [newClusterName, setNewClusterName] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const [draft, setDraft] = useState<SiteEffects>({
    ...DEFAULT_EFFECTS,
    ...(effects || {}),
  })
  const [saving, setSaving] = useState(false)

  const loadClusters = async () => {
    try {
      const list = await api.listAdminClusters()
      setClusters(list)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadClusters()
  }, [])

  const handleCreateCluster = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClusterName.trim() || creating) return
    setCreating(true)
    try {
      await api.createAdminCluster(newClusterName.trim())
      setNewClusterName('')
      await loadClusters()
      onClustersChanged()
    } catch (err: any) {
      alert(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (c: AdminCluster) => {
    try {
      await api.updateAdminCluster(c.id, { is_active: !c.is_active })
      await loadClusters()
      onClustersChanged()
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const handleCopyInvite = async (c: AdminCluster) => {
    const link = `${window.location.origin}/?invite=${c.invite_code}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(c.id)
      setTimeout(() => setCopiedId((prev) => (prev === c.id ? null : prev)), 2000)
    } catch {
      prompt('复制邀请链接：', link)
    }
  }

  const handleSaveEffects = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await api.updateSiteEffects(draft)
      onUpdated(updated)
      onClose()
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="upload-glass-modal liquid-glass"
        style={{ maxWidth: 500, maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="glass-pill-btn"
              style={{
                padding: '7px 14px',
                fontSize: 13,
                opacity: tab === 'clusters' ? 1 : 0.55,
              }}
              onClick={() => setTab('clusters')}
            >
              星群与邀请
            </button>
            <button
              type="button"
              className="glass-pill-btn"
              style={{
                padding: '7px 14px',
                fontSize: 13,
                opacity: tab === 'effects' ? 1 : 0.55,
              }}
              onClick={() => setTab('effects')}
            >
              星空效果
            </button>
          </div>
          <button
            className="glass-pill-btn"
            style={{ padding: 7 }}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {tab === 'clusters' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <form onSubmit={handleCreateCluster} style={{ display: 'flex', gap: 8 }}>
              <input
                className="glass-input"
                placeholder="输入新星群名称（如：2026生日夜）"
                value={newClusterName}
                onChange={(e) => setNewClusterName(e.target.value)}
              />
              <button
                type="submit"
                className="glass-pill-btn"
                disabled={!newClusterName.trim() || creating}
                style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}
              >
                <Plus size={15} />
                <span>新建</span>
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {clusters.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {c.photo_count} 颗星 · {c.members.length} 位成员
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="glass-pill-btn"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => handleCopyInvite(c)}
                        disabled={!c.is_active}
                      >
                        {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copiedId === c.id ? '已复制' : '邀请链接'}</span>
                      </button>
                      <button
                        type="button"
                        className="glass-pill-btn"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => handleToggleActive(c)}
                        title={c.is_active ? '点击封口（暂停邀请）' : '点击重新开放邀请'}
                      >
                        {c.is_active ? <Unlock size={13} /> : <Lock size={13} />}
                      </button>
                    </div>
                  </div>

                  {c.members.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {c.members.map((m) => (
                        <span
                          key={m.passcode}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            background: 'rgba(255,255,255,0.05)',
                            padding: '2px 8px',
                            borderRadius: 999,
                          }}
                        >
                          <span
                            className="star-dot"
                            style={{ backgroundColor: m.color }}
                          />
                          {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSaveEffects}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                <span>星光聚拢引力</span>
                <span>{(draft.gravity_strength ?? 1.0).toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="2.0"
                step="0.1"
                value={draft.gravity_strength ?? 1.0}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    gravity_strength: parseFloat(e.target.value),
                  }))
                }
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                <span>宇宙星云亮度</span>
                <span>{(draft.nebula_opacity ?? 1.0).toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="2.0"
                step="0.1"
                value={draft.nebula_opacity ?? 1.0}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    nebula_opacity: parseFloat(e.target.value),
                  }))
                }
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                入口标题
              </label>
              <input
                className="glass-input"
                value={draft.gate_title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, gate_title: e.target.value }))
                }
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                上传按钮文案
              </label>
              <input
                className="glass-input"
                value={draft.upload_label}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, upload_label: e.target.value }))
                }
              />
            </div>

            <button type="submit" className="glass-pill-btn" disabled={saving}>
              {saving ? '保存中…' : '保存效果'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
