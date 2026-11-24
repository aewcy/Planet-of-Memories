import React, { useEffect, useState } from 'react'
import { Check, Copy, Lock, LogOut, Plus, Unlock, X } from 'lucide-react'
import { api, type ClusterInfo } from '../api'

type UserClusterItem = ClusterInfo & {
  photo_count: number
  members: Array<{ name: string; color: string }>
}

interface Props {
  activeClusterId: number | null
  onSelectCluster: (id: number) => void
  onClustersChanged: () => void
  onClose: () => void
}

export const UserClusterModal: React.FC<Props> = ({
  activeClusterId,
  onSelectCluster,
  onClustersChanged,
  onClose,
}) => {
  const [clusters, setClusters] = useState<UserClusterItem[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [confirmLeaveId, setConfirmLeaveId] = useState<number | null>(null)

  const load = async () => {
    try {
      const list = await api.listMyClusters()
      setClusters(list)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const created = await api.createMyCluster(newName.trim())
      setNewName('')
      await load()
      onClustersChanged()
      onSelectCluster(created.id)
    } catch (err: any) {
      alert(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async (c: UserClusterItem) => {
    const link = `${window.location.origin}/?invite=${c.invite_code}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(c.id)
      setTimeout(() => setCopiedId((prev) => (prev === c.id ? null : prev)), 2000)
    } catch {
      prompt('复制邀请链接：', link)
    }
  }

  const handleToggleLock = async (c: UserClusterItem) => {
    try {
      await api.updateMyCluster(c.id, { is_active: !c.is_active })
      await load()
      onClustersChanged()
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const handleLeave = async (c: UserClusterItem) => {
    if (confirmLeaveId !== c.id) {
      setConfirmLeaveId(c.id)
      return
    }
    try {
      await api.leaveCluster(c.id)
      setConfirmLeaveId(null)
      await load()
      onClustersChanged()
      if (activeClusterId === c.id) {
        onSelectCluster(0)
      }
    } catch (err: any) {
      alert(err.message || '退出失败')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="upload-glass-modal liquid-glass"
        style={{ maxWidth: 460, maxHeight: '84vh', overflowY: 'auto' }}
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
          <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 18 }}>
            组建星群
          </h3>
          <button
            className="glass-pill-btn"
            style={{ padding: 7 }}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            className="glass-input"
            placeholder="新星群名字（如：我们的周末）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="submit"
            className="glass-pill-btn"
            disabled={!newName.trim() || creating}
            style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}
          >
            <Plus size={15} />
            <span>新建</span>
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {clusters.map((c) => {
            const isCurrent = c.id === activeClusterId
            return (
              <div
                key={c.id}
                onClick={() => {
                  onSelectCluster(c.id)
                  onClose()
                }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 16,
                  background: isCurrent ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)',
                  border: isCurrent
                    ? '1px solid rgba(255,255,255,0.28)'
                    : '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
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
                  <div
                    style={{ display: 'flex', gap: 6 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="glass-pill-btn"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => handleCopy(c)}
                      disabled={!c.is_active}
                    >
                      {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedId === c.id ? '已复制' : '邀请'}</span>
                    </button>
                    <button
                      type="button"
                      className="glass-pill-btn"
                      style={{ padding: '6px 10px', fontSize: 12 }}
                      onClick={() => handleToggleLock(c)}
                      title={c.is_active ? '点击封口（暂停邀请）' : '点击开放邀请'}
                    >
                      {c.is_active ? <Unlock size={13} /> : <Lock size={13} />}
                    </button>
                    <button
                      type="button"
                      className="glass-pill-btn"
                      style={{
                        padding: '6px 10px',
                        fontSize: 12,
                        color: confirmLeaveId === c.id ? '#f38ba8' : 'var(--text-secondary)',
                        borderColor:
                          confirmLeaveId === c.id ? 'rgba(243, 139, 168, 0.5)' : undefined,
                      }}
                      onClick={() => handleLeave(c)}
                      title={confirmLeaveId === c.id ? '再次点击确认退出星系' : '退出该星系'}
                    >
                      <LogOut size={13} />
                      {confirmLeaveId === c.id && <span>确认退出</span>}
                    </button>
                  </div>
                </div>

                {c.members.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {c.members.map((m, idx) => (
                      <span
                        key={`${m.name}-${idx}`}
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
                        <span className="star-dot" style={{ backgroundColor: m.color }} />
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
