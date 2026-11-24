import React, { useEffect, useState } from 'react'
import { BookOpen, RotateCcw, Save, X } from 'lucide-react'
import { api } from '../api'

interface MemoryModalProps {
  userName: string
  onClose: () => void
}

function familiarityLabel(turns: number): string {
  if (turns < 4) return '初识'
  if (turns < 15) return '逐渐熟络'
  return '老友'
}

export const MemoryModal: React.FC<MemoryModalProps> = ({ userName, onClose }) => {
  const [summary, setSummary] = useState('')
  const [turnCount, setTurnCount] = useState(0)
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    let active = true
    api
      .fetchUserMemory()
      .then((res) => {
        if (!active) return
        setSummary(res.summary || '')
        setTurnCount(res.turn_count || 0)
        setUpdatedAt(res.updated_at || '')
      })
      .catch(() => {
        if (active) setHint('读取印象失败，请稍后重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setHint('')
    try {
      const res = await api.updateUserMemory(summary)
      setSummary(res.summary)
      setUpdatedAt(res.updated_at)
      setHint('已保存，之后的对话会带着这份印象。')
    } catch (err) {
      setHint(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (saving) return
    setSaving(true)
    setHint('')
    try {
      const res = await api.clearUserMemory()
      setSummary(res.summary)
      setTurnCount(res.turn_count)
      setUpdatedAt('')
      setHint('已清空印象，我们重新慢慢认识。')
    } catch (err) {
      setHint(err instanceof Error ? err.message : '清空失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="upload-glass-modal liquid-glass"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={17} color="#f6c177" />
            <h3 style={{ margin: 0, fontSize: 16 }}>记录者对「{userName}」的印象</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span>
            熟络度：<strong style={{ color: '#f6c177' }}>{familiarityLabel(turnCount)}</strong>
          </span>
          <span>已聊 {turnCount} 句</span>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="glass-input"
            rows={6}
            value={summary}
            disabled={loading || saving}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={
              loading
                ? '正在翻找记忆本…'
                : '暂时还没有记下什么。多上传几张照片、慢慢聊几句后，记录者会悄悄记住你的习惯、喜好和近况；你也可以自己写几句让它了解你。'
            }
            style={{
              resize: 'vertical',
              minHeight: 136,
              lineHeight: 1.6,
              fontSize: 13.5,
              borderRadius: 16,
              padding: '12px 14px',
            }}
          />

          {updatedAt && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              最近更新：{updatedAt.replace('T', ' ').slice(0, 16)}
            </div>
          )}

          {hint && (
            <div style={{ fontSize: 12.5, color: '#a6e3a1' }}>{hint}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="glass-pill-btn"
              onClick={handleClear}
              disabled={loading || saving || (!summary && turnCount === 0)}
              style={{
                color: '#f38ba8',
                fontSize: 13,
                padding: '9px 14px',
              }}
            >
              <RotateCcw size={14} />
              <span>清空重来</span>
            </button>

            <button
              type="submit"
              className="glass-pill-btn"
              disabled={loading || saving}
              style={{
                background: 'rgba(246, 193, 119, 0.22)',
                borderColor: 'rgba(246, 193, 119, 0.48)',
                fontSize: 13,
                padding: '9px 16px',
              }}
            >
              <Save size={14} />
              <span>{saving ? '保存中…' : '保存印象'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
