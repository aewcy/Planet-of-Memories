import React, { useEffect, useRef, useState } from 'react'
import { Calendar, Camera, Edit3, Send, Sparkles, X } from 'lucide-react'
import { api, type SunConfig } from '../api'
import { compressImage } from '../utils/imageCompress'

interface Props {
  clusterId: number
  sunConfig: SunConfig
  accentColor: string
  onUpdated: (next: SunConfig) => void
  onClose: () => void
}

function getMetDaysText(metAt: string): string {
  if (!metAt) return ''
  const parsed = new Date(metAt)
  if (Number.isNaN(parsed.getTime())) return `相识于 ${metAt}`
  const diff = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24))
  if (diff >= 0) return `已相识 ${diff + 1} 天 · ${metAt}`
  return `相识于 ${metAt}`
}

export const SunModal: React.FC<Props> = ({
  clusterId,
  sunConfig,
  accentColor,
  onUpdated,
  onClose,
}) => {
  const hasPhoto = Boolean(sunConfig.photo)
  const [editing, setEditing] = useState(!hasPhoto)
  const [metAtInput, setMetAtInput] = useState(sunConfig.met_at || '')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState(sunConfig.photo?.url || '')
  const [saving, setSaving] = useState(false)

  // Chronicler chat state when viewing sun photo
  const [captionDraft, setCaptionDraft] = useState(sunConfig.photo?.caption || '')
  const [messages, setMessages] = useState(sunConfig.photo?.messages || [])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [sealing, setSealing] = useState(false)
  const [closing, setClosing] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  const handleClose = () => {
    if (closing) return
    setClosing(true)
    setTimeout(() => {
      onClose()
    }, 580)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closing])

  useEffect(() => {
    setCaptionDraft(sunConfig.photo?.caption || '')
    setMessages(sunConfig.photo?.messages || [])
    setMetAtInput(sunConfig.met_at || '')
    setPreviewUrl(sunConfig.photo?.url || '')
  }, [sunConfig])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, chatSending])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleSaveSun = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!sunConfig.photo && !selectedFile) {
      alert('请先选择一张恒星照片')
      return
    }
    setSaving(true)
    try {
      const fileToSend = selectedFile ? await compressImage(selectedFile) : null
      const updated = await api.saveSunConfig(clusterId, metAtInput, fileToSend)
      onUpdated(updated)
      setSelectedFile(null)
      setEditing(false)
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sunConfig.photo || !chatInput.trim() || chatSending) return
    const text = chatInput.trim()
    setChatInput('')
    setChatSending(true)

    const optimistic = {
      id: Date.now(),
      role: 'user' as const,
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const reply = await api.sendChat(sunConfig.photo.id, text)
      setMessages((prev) => [...prev, reply])
    } catch (err: any) {
      alert(err.message || '发送失败')
    } finally {
      setChatSending(false)
    }
  }

  const handleSeal = async () => {
    if (!sunConfig.photo || sealing) return
    setSealing(true)
    try {
      const updatedPhoto = await api.sealPhoto(sunConfig.photo.id)
      setCaptionDraft(updatedPhoto.caption)
      onUpdated({
        ...sunConfig,
        photo: { ...sunConfig.photo, caption: updatedPhoto.caption, is_sealed: true },
      })
    } catch (err: any) {
      alert(err.message || '封存失败')
    } finally {
      setSealing(false)
    }
  }

  const handleSaveCaption = async () => {
    if (!sunConfig.photo) return
    try {
      const updatedPhoto = await api.updatePhoto(sunConfig.photo.id, {
        caption: captionDraft,
        is_sealed: captionDraft.trim().length > 0,
      })
      onUpdated({
        ...sunConfig,
        photo: { ...sunConfig.photo, caption: updatedPhoto.caption, is_sealed: updatedPhoto.is_sealed },
      })
    } catch (err: any) {
      alert(err.message || '保存失败')
    }
  }

  return (
    <div
      className={`modal-backdrop ${closing ? 'is-closing' : ''}`}
      onClick={handleClose}
    >
      {editing ? (
        <div
          className={`upload-glass-modal liquid-glass ${closing ? 'is-closing' : ''}`}
          style={{
            transition: 'opacity 0.55s ease, transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
            ...(closing ? { opacity: 0, transform: 'scale(0.92)' } : {}),
          }}
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
              设定中央恒星
            </h3>
            <button
              className="glass-pill-btn"
              style={{ padding: 7 }}
              onClick={() => (sunConfig.photo ? setEditing(false) : handleClose())}
            >
              <X size={15} />
            </button>
          </div>

          <form
            onSubmit={handleSaveSun}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <label
              style={{
                border: '1px dashed rgba(255,255,255,0.25)',
                borderRadius: 16,
                padding: previewUrl ? 8 : 28,
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="恒星照片预览"
                  style={{
                    width: '100%',
                    maxHeight: 240,
                    objectFit: 'cover',
                    borderRadius: 10,
                  }}
                />
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  <Camera size={26} style={{ marginBottom: 8, color: accentColor }} />
                  <div>选择一张作为恒星核心的照片</div>
                </div>
              )}
            </label>

            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                <Calendar size={13} />
                <span>相识时间</span>
              </label>
              <input
                type="date"
                className="glass-input"
                value={metAtInput}
                onChange={(e) => setMetAtInput(e.target.value)}
              />
            </div>

            <button type="submit" className="glass-pill-btn" disabled={saving}>
              {saving ? '点亮恒星中…' : '保存恒星记忆'}
            </button>
          </form>
        </div>
      ) : (
        <div
          className={`zoom-panel liquid-glass ${closing ? 'is-closing' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="glass-pill-btn"
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              zIndex: 10,
              padding: '8px',
            }}
            onClick={handleClose}
          >
            <X size={16} />
          </button>

          <div className="zoom-left">
            <div className="zoom-polaroid">
              <img src={sunConfig.photo!.url} alt="恒星记忆" />
              <textarea
                rows={3}
                className="zoom-caption-textarea"
                placeholder="写下关于这颗恒星的批注…"
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value)}
                onBlur={handleSaveCaption}
              />
              <div className="stack-card-meta" style={{ padding: '0 6px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="star-dot" style={{ backgroundColor: accentColor }} />
                  中央恒星
                </span>
                <span>{sunConfig.met_at ? getMetDaysText(sunConfig.met_at) : ''}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                className="glass-pill-btn"
                onClick={handleSeal}
                disabled={sealing}
              >
                <Sparkles size={14} />
                <span>{sealing ? '记录者整理中…' : '封存这一刻'}</span>
              </button>
              <button
                className="glass-pill-btn"
                style={{ padding: '10px 14px' }}
                onClick={() => setEditing(true)}
                title="更换照片或修改相识时间"
              >
                <Edit3 size={14} />
              </button>
            </div>
          </div>

          <div className="zoom-right">
            <div className="chat-header">
              <h4>
                <Sparkles size={16} color={accentColor} />
                <span>记录者</span>
              </h4>
            </div>

            <div className="chat-messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                  {msg.content}
                </div>
              ))}
              {chatSending && (
                <div className="chat-bubble assistant" style={{ opacity: 0.7 }}>
                  记录者正在思索…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form className="chat-footer" onSubmit={handleSendChat}>
              <div className="chat-input-row">
                <input
                  className="glass-input"
                  placeholder="聊聊这张照片…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatSending}
                />
                <button
                  type="submit"
                  className="glass-pill-btn"
                  disabled={!chatInput.trim() || chatSending}
                  style={{ padding: '10px 16px' }}
                >
                  <Send size={15} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
