import React, { useEffect, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'

interface Props {
  src: string
  alt?: string
  onClose: () => void
}

export const ImageLightbox: React.FC<Props> = ({ src, alt = '查看大图', onClose }) => {
  const [scrollMode, setScrollMode] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight / img.naturalWidth > 1.75) {
      setScrollMode(true)
    }
  }

  return (
    <div
      className="image-lightbox-backdrop"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="image-lightbox-toolbar"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="glass-pill-btn"
          style={{ padding: '8px 12px', fontSize: 12 }}
          onClick={() => setScrollMode((v) => !v)}
          title={scrollMode ? '适应屏幕' : '展开长图 / 原比例查看'}
        >
          {scrollMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          <span>{scrollMode ? '适应屏幕' : '展开查看'}</span>
        </button>
        <button
          type="button"
          className="glass-pill-btn"
          style={{ padding: '8px' }}
          onClick={onClose}
          title="关闭大图"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className={`image-lightbox-stage ${scrollMode ? 'is-scroll' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <img
          src={src}
          alt={alt}
          className={`image-lightbox-img ${scrollMode ? 'is-scroll' : ''}`}
          onLoad={handleImageLoad}
          onClick={(e) => {
            e.stopPropagation()
            setScrollMode((v) => !v)
          }}
          title={scrollMode ? '点击切换为适应屏幕' : '点击展开查看完整图片'}
        />
      </div>
    </div>
  )
}
