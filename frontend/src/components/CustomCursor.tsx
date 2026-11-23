import React, { useEffect, useRef, useState } from 'react'

interface Props {
  accentColor?: string
}

type CursorMode = 'default' | 'pointer' | 'prev' | 'next' | 'zoom' | 'text'

export const CustomCursor: React.FC<Props> = ({ accentColor = '#f6c177' }) => {
  const dotRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)

  const targetRef = useRef({ x: -100, y: -100 })
  const ringPosRef = useRef({ x: -100, y: -100 })
  const [visible, setVisible] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [mode, setMode] = useState<CursorMode>('default')
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (coarse) {
      setIsTouchDevice(true)
      return
    }

    const detectMode = (target: EventTarget | null): CursorMode => {
      if (!(target instanceof HTMLElement)) return 'default'
      const zone = target.closest('[data-cursor]')?.getAttribute('data-cursor')
      if (zone === 'prev' || zone === 'next' || zone === 'zoom' || zone === 'pointer') {
        return zone
      }
      if (target.closest('input, textarea')) return 'text'
      if (target.closest('button, a, label, [role="button"]')) return 'pointer'
      const computed = window.getComputedStyle(target).cursor
      if (computed === 'pointer') return 'pointer'
      return 'default'
    }

    const onMove = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY }
      if (!visible) {
        ringPosRef.current = { x: e.clientX, y: e.clientY }
        setVisible(true)
      }
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      }
      setMode(detectMode(e.target))
    }

    const onLeave = () => setVisible(false)
    const onDown = () => setPressed(true)
    const onUp = () => setPressed(false)

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)

    let rafId = 0
    const tick = () => {
      const rx = ringPosRef.current.x
      const ry = ringPosRef.current.y
      const tx = targetRef.current.x
      const ty = targetRef.current.y
      ringPosRef.current.x = rx + (tx - rx) * 0.16
      ringPosRef.current.y = ry + (ty - ry) * 0.16

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringPosRef.current.x}px, ${ringPosRef.current.y}px, 0)`
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [visible])

  if (isTouchDevice) return null

  return (
    <>
      <div
        ref={ringRef}
        className={`custom-cursor-ring is-${mode} ${visible ? 'is-visible' : ''} ${
          pressed ? 'is-pressed' : ''
        }`}
        style={{ ['--cursor-accent' as string]: accentColor }}
      >
        {mode === 'prev' && <span className="cursor-glyph">‹</span>}
        {mode === 'next' && <span className="cursor-glyph">›</span>}
        {mode === 'zoom' && <span className="cursor-glyph">+</span>}
      </div>
      <div
        ref={dotRef}
        className={`custom-cursor-dot is-${mode} ${visible ? 'is-visible' : ''} ${
          pressed ? 'is-pressed' : ''
        }`}
        style={{ ['--cursor-accent' as string]: accentColor }}
      />
    </>
  )
}
