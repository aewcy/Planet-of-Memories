import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Send, Sparkles, Trash2, X } from 'lucide-react'
import { api, type PhotoItem } from '../api'

interface Props {
  photos: PhotoItem[]
  initialPhotoId: number
  onStartClose?: () => void
  onClose: () => void
  onPhotoUpdated: (updated: PhotoItem) => void
  onPhotoDeleted: (id: number) => void
}

export const PhotoStackModal: React.FC<Props> = ({
  photos,
  initialPhotoId,
  onStartClose,
  onClose,
  onPhotoUpdated,
  onPhotoDeleted,
}) => {
  const initialIdx = Math.max(
    0,
    photos.findIndex((p) => p.id === initialPhotoId)
  )
  const [currentIndex, setCurrentIndex] = useState(initialIdx)
  const [zoomPhase, setZoomPhase] = useState<'stack' | 'expanding' | 'zoomed' | 'collapsing'>('stack')
  const [chromeHidden, setChromeHidden] = useState(false)
  const [sideCardsFaded, setSideCardsFaded] = useState(false)
  const [closingModal, setClosingModal] = useState(false)

  // Zoomed detail + Chronicler chat state
  const [detail, setDetail] = useState<PhotoItem | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [sealing, setSealing] = useState(false)

  const lastWheelRef = useRef(0)
  const touchStartXRef = useRef<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const activeCardRef = useRef<HTMLDivElement | null>(null)
  const zoomPolaroidRef = useRef<HTMLDivElement | null>(null)
  const flipFromRectRef = useRef<DOMRect | null>(null)
  const phaseTimerRef = useRef<number | null>(null)

  const zoomed = zoomPhase !== 'stack'
  const currentPhoto = photos[currentIndex]

  const clearPhaseTimer = () => {
    if (phaseTimerRef.current !== null) {
      window.clearTimeout(phaseTimerRef.current)
      phaseTimerRef.current = null
    }
  }

  useEffect(() => () => clearPhaseTimer(), [])

  const goPrev = () => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : photos.length - 1))
  }

  const goNext = () => {
    setCurrentIndex((i) => (i < photos.length - 1 ? i + 1 : 0))
  }

  const enterZoom = () => {
    if (zoomPhase !== 'stack') return
    clearPhaseTimer()
    flipFromRectRef.current = activeCardRef.current?.getBoundingClientRect() ?? null
    setChromeHidden(true)
    setSideCardsFaded(false)
    setZoomPhase('expanding')
    phaseTimerRef.current = window.setTimeout(() => {
      setZoomPhase('zoomed')
      setSideCardsFaded(false)
    }, 480)
  }

  const exitZoom = () => {
    if (zoomPhase !== 'zoomed' && zoomPhase !== 'expanding') return
    clearPhaseTimer()
    flipFromRectRef.current = zoomPolaroidRef.current?.getBoundingClientRect() ?? null
    setChromeHidden(true)
    setSideCardsFaded(true)
    setZoomPhase('collapsing')
    phaseTimerRef.current = window.setTimeout(() => {
      if (zoomPolaroidRef.current) {
        zoomPolaroidRef.current.style.transition = ''
        zoomPolaroidRef.current.style.transform = ''
      }
      setZoomPhase('stack')
      setChromeHidden(false)
      setSideCardsFaded(false)
    }, 460)
  }

  useLayoutEffect(() => {
    if (zoomPhase === 'expanding') {
      const targetEl = zoomPolaroidRef.current
      const fromRect = flipFromRectRef.current
      if (targetEl && fromRect) {
        const toRect = targetEl.getBoundingClientRect()
        const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2)
        const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2)
        const scale = toRect.width > 0 ? fromRect.width / toRect.width : 1
        targetEl.style.transition = 'none'
        targetEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`
        void targetEl.offsetWidth
        requestAnimationFrame(() => {
          if (!zoomPolaroidRef.current) return
          zoomPolaroidRef.current.style.transition =
            'transform 0.48s cubic-bezier(0.22, 1, 0.36, 1)'
          zoomPolaroidRef.current.style.transform = 'translate3d(0, 0, 0) scale(1)'
          setChromeHidden(false)
          setSideCardsFaded(true)
        })
      } else {
        requestAnimationFrame(() => {
          setChromeHidden(false)
          setSideCardsFaded(true)
        })
      }
    } else if (zoomPhase === 'collapsing') {
      const movingEl = zoomPolaroidRef.current
      const targetCard = activeCardRef.current
      const fromRect = flipFromRectRef.current
      if (movingEl && targetCard && fromRect) {
        const toRect = targetCard.getBoundingClientRect()
        const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2)
        const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2)
        const scale = fromRect.width > 0 ? toRect.width / fromRect.width : 1
        movingEl.style.transition = 'none'
        movingEl.style.transform = 'translate3d(0, 0, 0) scale(1)'
        void movingEl.offsetWidth
        requestAnimationFrame(() => {
          if (!zoomPolaroidRef.current) return
          zoomPolaroidRef.current.style.transition =
            'transform 0.46s cubic-bezier(0.22, 1, 0.36, 1)'
          zoomPolaroidRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`
          setSideCardsFaded(false)
        })
      } else {
        requestAnimationFrame(() => setSideCardsFaded(false))
      }
    }
  }, [zoomPhase])

  const exitModal = () => {
    if (closingModal) return
    setClosingModal(true)
    onStartClose?.()
    setTimeout(() => {
      onClose()
    }, 500)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomed) exitZoom()
        else exitModal()
      } else if (!zoomed && e.key === 'ArrowLeft') {
        goPrev()
      } else if (!zoomed && e.key === 'ArrowRight') {
        goNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomPhase, closingModal, photos.length])

  // Load full detail & messages when zoomed
  useEffect(() => {
    if (!zoomed || !currentPhoto) return
    api
      .getPhotoDetail(currentPhoto.id)
      .then((res) => {
        setDetail(res)
        setCaptionDraft(res.caption || '')
      })
      .catch(console.error)
  }, [zoomed, currentPhoto?.id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [detail?.messages?.length, chatSending])

  const handleWheel = (e: React.WheelEvent) => {
    if (zoomed || photos.length <= 1) return
    const now = Date.now()
    if (now - lastWheelRef.current < 220) return
    if (Math.abs(e.deltaY) < 10 && Math.abs(e.deltaX) < 10) return
    lastWheelRef.current = now
    if (e.deltaY > 0 || e.deltaX > 0) {
      goNext()
    } else {
      goPrev()
    }
  }

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail || !chatInput.trim() || chatSending) return
    const text = chatInput.trim()
    setChatInput('')
    setChatSending(true)

    const optimistic = {
      id: Date.now(),
      role: 'user' as const,
      content: text,
      created_at: new Date().toISOString(),
    }
    setDetail((prev) =>
      prev ? { ...prev, messages: [...(prev.messages || []), optimistic] } : prev
    )

    try {
      const reply = await api.sendChat(detail.id, text)
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: [...(prev.messages || []), reply],
              message_count: (prev.message_count || 0) + 2,
            }
          : prev
      )
    } catch (err: any) {
      alert(err.message || '发送失败')
    } finally {
      setChatSending(false)
    }
  }

  const handleSealMemory = async () => {
    if (!detail || sealing) return
    setSealing(true)
    try {
      const updated = await api.sealPhoto(detail.id)
      setCaptionDraft(updated.caption)
      setDetail((prev) =>
        prev ? { ...prev, caption: updated.caption, is_sealed: updated.is_sealed } : prev
      )
      onPhotoUpdated(updated)
    } catch (err: any) {
      alert(err.message || '封存失败')
    } finally {
      setSealing(false)
    }
  }

  const handleSaveCaption = async () => {
    if (!detail) return
    try {
      const updated = await api.updatePhoto(detail.id, {
        caption: captionDraft,
        is_sealed: captionDraft.trim().length > 0,
      })
      setDetail((prev) =>
        prev ? { ...prev, caption: updated.caption, is_sealed: updated.is_sealed } : prev
      )
      onPhotoUpdated(updated)
    } catch (err: any) {
      alert(err.message || '保存失败')
    }
  }

  const handleToggleOrbit = async () => {
    if (!detail) return
    const nextOrbit = detail.in_orbit === false
    try {
      const updated = await api.updatePhoto(detail.id, { in_orbit: nextOrbit })
      setDetail((prev) => (prev ? { ...prev, in_orbit: updated.in_orbit } : prev))
      onPhotoUpdated(updated)
    } catch (err: any) {
      alert(err.message || '切换失败')
    }
  }

  const handleDelete = async () => {
    if (!detail) return
    if (!confirm('确定要让这颗记忆星星从夜空消失吗？')) return
    try {
      await api.deletePhoto(detail.id)
      onPhotoDeleted(detail.id)
      if (photos.length <= 1) {
        onClose()
      } else {
        setZoomPhase('stack')
        setChromeHidden(false)
        setSideCardsFaded(false)
        setCurrentIndex((i) => (i >= photos.length - 1 ? 0 : i))
      }
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  if (!currentPhoto) return null

  const showStack = zoomPhase !== 'zoomed'
  const showZoom = zoomPhase !== 'stack'
  const isTransitioning = zoomPhase === 'expanding' || zoomPhase === 'collapsing'

  return (
    <div
      className={`modal-backdrop ${closingModal ? 'is-closing' : ''}`}
      onWheel={handleWheel}
      onClick={() => (zoomed ? exitZoom() : exitModal())}
    >
      {showStack && (
        <>
          <div
            className={`stack-stage ${closingModal ? 'is-closing' : ''}`}
            style={
              isTransitioning
                ? {
                    position: 'fixed',
                    inset: 0,
                    margin: 'auto',
                    pointerEvents: 'none',
                    zIndex: 42,
                  }
                : undefined
            }
            onTouchStart={(e) => {
              if (isTransitioning) return
              touchStartXRef.current = e.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(e) => {
              if (isTransitioning || touchStartXRef.current === null || photos.length <= 1) return
              const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current
              const diff = endX - touchStartXRef.current
              touchStartXRef.current = null
              if (Math.abs(diff) > 42) {
                if (diff < 0) goNext()
                else goPrev()
              }
            }}
          >
            {photos.map((photo, idx) => {
              let offset = idx - currentIndex
              // Wrap around for smooth circular stack feel
              if (photos.length > 2) {
                if (offset > photos.length / 2) offset -= photos.length
                if (offset < -photos.length / 2) offset += photos.length
              }
              if (Math.abs(offset) > 2) return null

              const isActive = offset === 0
              const stepX = typeof window !== 'undefined' && window.innerWidth < 560 ? 26 : 56
              const spreadX = sideCardsFaded && !isActive ? offset * 18 : 0
              const translateX = offset * stepX + spreadX
              const translateY = Math.abs(offset) * 10
              const scale = 1 - Math.abs(offset) * 0.08
              const rotate = offset * 4.5
              const zIndex = 10 - Math.abs(offset)
              const baseOpacity = isActive ? 1 : 0.65 - Math.abs(offset) * 0.18
              const opacity = isActive
                ? isTransitioning
                  ? 0
                  : 1
                : sideCardsFaded
                  ? 0
                  : baseOpacity

              return (
                <div
                  key={photo.id}
                  ref={isActive ? activeCardRef : undefined}
                  className="stack-card"
                  style={{
                    zIndex,
                    opacity,
                    transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
                    filter: isActive ? 'none' : 'brightness(0.75)',
                    pointerEvents: isActive && !isTransitioning ? 'auto' : 'none',
                    transition: isTransitioning
                      ? 'opacity 0.28s ease, transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)'
                      : undefined,
                  }}
                  onClick={isActive ? (e) => e.stopPropagation() : undefined}
                >
                  <div className="stack-card-img-wrap">
                    <img src={photo.url} alt={photo.caption || '记忆照片'} />

                    {isActive && (
                      <div className="stack-zones">
                        <div
                          className="stack-zone"
                          data-cursor="prev"
                          onClick={goPrev}
                          title="上一张"
                        />
                        <div
                          className="stack-zone"
                          data-cursor="zoom"
                          onClick={enterZoom}
                          title="放大"
                        />
                        <div
                          className="stack-zone"
                          data-cursor="next"
                          onClick={goNext}
                          title="下一张"
                        />
                      </div>
                    )}
                  </div>

                  <div className="stack-card-footer">
                    <p className="stack-card-caption">
                      {photo.caption || '点击照片中间放大，和「记录者」聊聊这一刻…'}
                    </p>
                    <div className="stack-card-meta">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span
                          className="star-dot"
                          style={{ backgroundColor: photo.author_color }}
                        />
                        {photo.author_name}
                      </span>
                      <span>{photo.taken_at}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div
            className={`stack-controls-bar ${closingModal || sideCardsFaded ? 'is-closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="liquid-glass" style={{ padding: '7px 14px', borderRadius: 999, fontSize: 12, color: 'var(--text-secondary)' }}>
              {currentIndex + 1} / {photos.length}
            </span>
          </div>
        </>
      )}

      {showZoom && (
        <div
          className={`zoom-panel liquid-glass ${chromeHidden ? 'is-chrome-hidden' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="glass-pill-btn zoom-chrome-fade"
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              zIndex: 10,
              padding: '8px',
            }}
            onClick={exitZoom}
            title="收起放大"
          >
            <X size={16} />
          </button>

          <div className="zoom-left">
            <div ref={zoomPolaroidRef} className="zoom-polaroid">
              <img src={currentPhoto.url} alt="放大照片" />
              <textarea
                rows={3}
                className="zoom-caption-textarea"
                placeholder="这里会留下你的拍立得批注（可直接编辑，或点击下方让记录者帮你总结）"
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value)}
                onBlur={handleSaveCaption}
              />
              <div className="stack-card-meta" style={{ padding: '0 6px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className="star-dot"
                    style={{ backgroundColor: currentPhoto.author_color }}
                  />
                  {currentPhoto.author_name}
                </span>
                <span>{currentPhoto.taken_at}</span>
              </div>
            </div>

            <div
              className="zoom-chrome-fade"
              style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}
            >
              <button
                className="glass-pill-btn"
                onClick={handleSealMemory}
                disabled={sealing}
              >
                <Sparkles size={14} />
                <span>{sealing ? '记录者整理中…' : '封存这一刻'}</span>
              </button>
              <button
                className="glass-pill-btn"
                style={{ padding: '10px 14px', fontSize: 13 }}
                onClick={handleToggleOrbit}
                title="切换星系内公转 / 外环漂流"
              >
                <span>{detail?.in_orbit === false ? '外环漂流中' : '星系内公转'}</span>
              </button>
              <button
                className="glass-pill-btn"
                style={{ padding: '10px 14px' }}
                onClick={handleDelete}
                title="删除这颗星星"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="zoom-right">
            <div className="chat-header">
              <h4>
                <Sparkles size={16} color={currentPhoto.author_color} />
                <span>记录者</span>
              </h4>
            </div>

            <div className="chat-messages">
              {(detail?.messages || []).map((msg) => (
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
                  placeholder="说说当时发生了什么…"
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
