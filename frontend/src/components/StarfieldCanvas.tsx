import React, { useEffect, useRef, useState } from 'react'
import { Lock, RotateCcw, Unlock } from 'lucide-react'
import type { PhotoItem, PublicStar, SunConfig } from '../api'

export interface StarNode {
  id: number
  takenAt: string
  color: string
  x: number
  y: number
  ox: number // orbital offset X relative to central star
  oy: number // orbital offset Y relative to central star
  vx: number
  vy: number
  orbitRadius: number
  orbitAngle: number
  orbitSpeed: number
  inOrbit: boolean
  driftX: number // normalized 0..1 screen X for outer-ring drifting stars
  driftY: number // normalized 0..1 screen Y for outer-ring drifting stars
  driftVx: number
  driftVy: number
  baseRadius: number
  twinklePhase: number
  recency: number // 0 (oldest) -> 1 (newest)
  birthProgress: number // 0 -> 1 for newly born star animation
  photo?: PhotoItem
}

interface BgDust {
  x: number
  y: number
  r: number
  alpha: number
  phase: number
}

export interface OtherSystem {
  id: number
  name: string
  color: string
}

interface Props {
  stars: Array<PublicStar | PhotoItem>
  unlocked: boolean
  accentColor?: string
  focusedStarId?: number | null
  bornStarId?: number | null
  sunConfig?: SunConfig | null
  otherSystems?: OtherSystem[]
  activeClusterId?: number
  nebulaOpacity?: number
  filterAuthor?: string | null
  onSelectStar: (id: number) => void
  onSelectSun?: () => void
  onSwitchCluster?: (id: number) => void
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(246, 193, 119, ${alpha})`
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatMetDays(metAt: string): string {
  if (!metAt) return ''
  const parsed = new Date(metAt)
  if (Number.isNaN(parsed.getTime())) return `相识于 ${metAt}`
  const diff = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24))
  if (diff >= 0) return `已相识 ${diff + 1} 天 · ${metAt}`
  return `相识于 ${metAt}`
}

export const StarfieldCanvas: React.FC<Props> = ({
  stars,
  unlocked,
  accentColor = '#f6c177',
  focusedStarId = null,
  bornStarId = null,
  sunConfig = null,
  otherSystems = [],
  activeClusterId = 0,
  nebulaOpacity = 1.0,
  filterAuthor = null,
  onSelectStar,
  onSelectSun,
  onSwitchCluster,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodesRef = useRef<StarNode[]>([])
  const dustRef = useRef<BgDust[]>([])
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  })
  // Persists last perspective even when pointer leaves browser window
  const lastViewRef = useRef<{ normX: number; normY: number; dist: number }>({
    normX: 0,
    normY: 0,
    dist: 0,
  })
  const camPosRef = useRef<{ x: number; y: number; scale: number }>({
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    scale: 1,
  })
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked
  const accentRef = useRef(accentColor)
  accentRef.current = accentColor
  const focusedRef = useRef(focusedStarId)
  focusedRef.current = focusedStarId
  const sunRef = useRef(sunConfig)
  sunRef.current = sunConfig
  const otherSystemsRef = useRef(otherSystems)
  otherSystemsRef.current = otherSystems
  const nebulaRef = useRef(nebulaOpacity)
  nebulaRef.current = nebulaOpacity
  const filterAuthorRef = useRef(filterAuthor)
  filterAuthorRef.current = filterAuthor
  const warpTriggerRef = useRef(0)

  const [hovered, setHovered] = useState<{
    node: StarNode
    x: number
    y: number
  } | null>(null)
  const [hoveredSun, setHoveredSun] = useState<{ x: number; y: number } | null>(null)
  const [hoveredGalaxy, setHoveredGalaxy] = useState<{
    sys: OtherSystem
    x: number
    y: number
  } | null>(null)
  const [touchPreview, setTouchPreview] = useState<
    | { kind: 'star'; id: number }
    | { kind: 'sun' }
    | { kind: 'galaxy'; id: number }
    | null
  >(null)
  const touchPreviewRef = useRef(touchPreview)
  touchPreviewRef.current = touchPreview
  const galaxyPosRef = useRef<Array<{ sys: OtherSystem; x: number; y: number }>>([])

  useEffect(() => {
    warpTriggerRef.current += 1
  }, [activeClusterId])
  const [viewLocked, setViewLocked] = useState(false)
  const viewLockedRef = useRef(false)
  viewLockedRef.current = viewLocked
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // Sync incoming stars into physics nodes while preserving existing positions.
  useEffect(() => {
    const canvas = canvasRef.current
    const w = canvas?.width || window.innerWidth
    const h = canvas?.height || window.innerHeight
    const existingMap = new Map(nodesRef.current.map((n) => [n.id, n]))
    const total = stars.length

    nodesRef.current = stars.map((s, idx) => {
      const prev = existingMap.get(s.id)
      const recency = total <= 1 ? 1 : idx / (total - 1)
      const photoItem = 'url' in s ? s : undefined
      const inOrbit = photoItem ? photoItem.in_orbit !== false : true
      if (prev) {
        prev.color = s.author_color
        prev.takenAt = s.taken_at
        prev.recency = recency
        prev.inOrbit = inOrbit
        prev.photo = photoItem
        return prev
      }
      const cx = w * 0.5
      const cy = h * 0.5
      const minSide = Math.min(w, h)
      const isNarrow = minSide < 560
      const minOrbit = isNarrow ? 68 : 125
      const maxOrbit = isNarrow ? Math.min(176, minSide * 0.38) : Math.min(340, minSide * 0.38)
      const orbitRadius = minOrbit + Math.random() * Math.max(40, maxOrbit - minOrbit)
      const orbitAngle = Math.random() * Math.PI * 2
      const ox = Math.cos(orbitAngle) * orbitRadius
      const oy = Math.sin(orbitAngle) * orbitRadius
      const driftX = Math.random() < 0.5 ? 0.08 + Math.random() * 0.14 : 0.78 + Math.random() * 0.14
      const driftY = Math.random() < 0.5 ? 0.1 + Math.random() * 0.16 : 0.74 + Math.random() * 0.16
      return {
        id: s.id,
        takenAt: s.taken_at,
        color: s.author_color || '#f6c177',
        x: cx + ox,
        y: cy + oy,
        ox,
        oy,
        vx: 0,
        vy: 0,
        orbitRadius,
        orbitAngle,
        // Inner stars revolve slightly faster than outer stars (ultra-serene pace)
        orbitSpeed: (0.00042 + (1 - recency * 0.3) * 0.00042) * (150 / Math.max(120, orbitRadius)),
        inOrbit,
        driftX,
        driftY,
        driftVx: (Math.random() - 0.5) * 0.00009,
        driftVy: (Math.random() - 0.5) * 0.00009,
        baseRadius: 3.2 + recency * 1.4,
        twinklePhase: Math.random() * Math.PI * 2,
        recency,
        birthProgress: s.id === bornStarId ? 0 : 1,
        photo: photoItem,
      }
    })
  }, [stars, bornStarId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (dustRef.current.length === 0) {
        // Richer multi-depth distant cosmos stars, kept very faint so memory stars stand out
        dustRef.current = Array.from({ length: 220 }, () => {
          const isMilkyWay = Math.random() < 0.45
          const t = Math.random()
          const bandX = t * window.innerWidth
          const bandY =
            window.innerHeight * (0.78 - t * 0.56) +
            (Math.random() - 0.5) * window.innerHeight * 0.34
          return {
            x: isMilkyWay ? bandX : Math.random() * window.innerWidth,
            y: isMilkyWay ? bandY : Math.random() * window.innerHeight,
            r: 0.35 + Math.random() * 1.15,
            alpha: isMilkyWay
              ? 0.08 + Math.random() * 0.24
              : 0.04 + Math.random() * 0.16,
            phase: Math.random() * Math.PI * 2,
          }
        })
      }
    }

    resize()
    window.addEventListener('resize', resize)

    let rafId = 0
    let frame = 0
    let introProgress = 0
    let lastWarpSeen = warpTriggerRef.current
    let warpFade = 0
    let camX = window.innerWidth * 0.5
    let camY = window.innerHeight * 0.5
    let camScale = 1
    let orbitSquashY = 1
    let focusBlend = 0

    const galaxyAnchors = [
      { ax: 0.14, ay: 0.24 },
      { ax: 0.85, ay: 0.76 },
      { ax: 0.16, ay: 0.76 },
      { ax: 0.84, ay: 0.24 },
      { ax: 0.28, ay: 0.14 },
      { ax: 0.72, ay: 0.86 },
    ]

    const render = () => {
      frame += 1
      if (warpTriggerRef.current !== lastWarpSeen) {
        lastWarpSeen = warpTriggerRef.current
        introProgress = 0.05
        warpFade = 1
      }
      if (warpFade > 0) {
        warpFade = Math.max(0, warpFade - 0.022)
      }
      introProgress = Math.min(1, introProgress + 0.014)
      const width = window.innerWidth
      const height = window.innerHeight
      ctx.clearRect(0, 0, width, height)

      const isFocused = focusedRef.current !== null
      const isLocked = viewLockedRef.current
      const shouldShiftFocus = isFocused && !isLocked
      const isUnlocked = unlockedRef.current
      const mouse = mouseRef.current
      const targetFocus = shouldShiftFocus ? 1 : 0
      focusBlend += (targetFocus - focusBlend) * 0.018

      // Keep last perspective when pointer leaves the window or when perspective is locked
      if (isUnlocked && mouse.active && !isFocused && !isLocked) {
        const nx = Math.max(-1, Math.min(1, (mouse.x - width * 0.5) / (width * 0.5)))
        const ny = Math.max(-1, Math.min(1, (mouse.y - height * 0.5) / (height * 0.5)))
        lastViewRef.current = {
          normX: nx,
          normY: ny,
          dist: Math.min(1, Math.hypot(nx, ny)),
        }
      }
      const { normX, normY, dist: mouseDistRatio } = isUnlocked
        ? lastViewRef.current
        : { normX: 0, normY: 0, dist: 0 }

      const focusCornerX = normX >= 0 ? width * 0.18 : width * 0.82
      const focusCornerY = normY >= 0 ? height * 0.2 : height * 0.8

      const targetCamX = shouldShiftFocus
        ? focusCornerX
        : width * 0.5 - normX * width * 0.24
      const targetCamY = shouldShiftFocus
        ? focusCornerY
        : height * 0.5 - normY * height * 0.16
      const targetCamScale = shouldShiftFocus
        ? 0.42
        : 1.0 - mouseDistRatio * 0.42
      const targetSquashY = shouldShiftFocus
        ? 0.36
        : 1.0 - mouseDistRatio * 0.66

      const camLerp = isFocused || focusBlend > 0.005 ? 0.024 : 0.032
      camX += (targetCamX - camX) * camLerp
      camY += (targetCamY - camY) * camLerp
      camScale += (targetCamScale - camScale) * camLerp
      orbitSquashY += (targetSquashY - orbitSquashY) * camLerp
      camPosRef.current = { x: camX, y: camY, scale: camScale }

      // Faint soft cosmic nebula clouds along a diagonal Milky Way (no hard edges)
      const nebAlpha = nebulaRef.current
      if (nebAlpha > 0.01) {
        const nebulaClouds = [
          { cx: width * 0.28, cy: height * 0.68, r: Math.max(width, height) * 0.42, c: `rgba(64, 92, 165, ${0.085 * nebAlpha})` },
          { cx: width * 0.52, cy: height * 0.48, r: Math.max(width, height) * 0.46, c: `rgba(104, 78, 158, ${0.075 * nebAlpha})` },
          { cx: width * 0.76, cy: height * 0.28, r: Math.max(width, height) * 0.38, c: `rgba(52, 112, 144, ${0.07 * nebAlpha})` },
        ]
        for (const cloud of nebulaClouds) {
          const g = ctx.createRadialGradient(cloud.cx, cloud.cy, 0, cloud.cx, cloud.cy, cloud.r)
          g.addColorStop(0, cloud.c)
          g.addColorStop(0.55, `rgba(30, 42, 78, ${0.025 * nebAlpha})`)
          g.addColorStop(1, 'rgba(0, 0, 0, 0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, width, height)
        }
      }

      // Faint ambient background dust stars
      for (const d of dustRef.current) {
        const twinkle = 0.65 + 0.35 * Math.sin(frame * 0.015 + d.phase)
        // Subtle parallax shift when looking back at the central star
        const px = d.x + (camX - width * 0.5) * 0.08
        const py = d.y + (camY - height * 0.5) * 0.08
        ctx.beginPath()
        ctx.arc(px, py, d.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${d.alpha * twinkle})`
        ctx.fill()
      }

      // Central Primary Star (layered photosphere, rotating corona, solar ring & embers)
      const starPulse = 0.94 + 0.06 * Math.sin(frame * 0.022)
      const centralColor = accentRef.current || '#f6c177'
      const introEase = 1 - Math.pow(1 - introProgress, 3)
      const coreScale = camScale * starPulse * (0.4 + 0.6 * introEase)

      const sunHoverDist =
        isUnlocked && mouse.active && !isFocused
          ? Math.hypot(mouse.x - camX, mouse.y - camY)
          : Infinity
      const isSunHot = sunHoverDist < Math.max(26, 40 * camScale)

      // Outer atmospheric corona
      const coronaR = (isSunHot ? 210 : 180) * coreScale
      const coronaGrad = ctx.createRadialGradient(camX, camY, 0, camX, camY, coronaR)
      coronaGrad.addColorStop(0, 'rgba(255, 253, 246, 0.7)')
      coronaGrad.addColorStop(0.12, hexToRgba(centralColor, 0.44))
      coronaGrad.addColorStop(0.32, hexToRgba(centralColor, 0.16))
      coronaGrad.addColorStop(0.65, hexToRgba(centralColor, 0.04))
      coronaGrad.addColorStop(1, hexToRgba(centralColor, 0))
      ctx.beginPath()
      ctx.arc(camX, camY, coronaR, 0, Math.PI * 2)
      ctx.fillStyle = coronaGrad
      ctx.fill()

      // Rotating inner accretion / solar ring
      ctx.save()
      ctx.translate(camX, camY)
      ctx.scale(1, 0.72 + 0.28 * orbitSquashY)
      ctx.rotate(frame * 0.003)
      for (let seg = 0; seg < 3; seg++) {
        const a0 = (seg * Math.PI * 2) / 3
        ctx.beginPath()
        ctx.arc(0, 0, 28 * coreScale, a0, a0 + 1.25)
        ctx.strokeStyle = hexToRgba(centralColor, isSunHot ? 0.42 : 0.22)
        ctx.lineWidth = 1.4
        ctx.stroke()
      }
      ctx.restore()

      // Soft inner photosphere core
      const innerR = 18 * coreScale
      const innerGrad = ctx.createRadialGradient(camX, camY, 0, camX, camY, innerR)
      innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.98)')
      innerGrad.addColorStop(0.48, hexToRgba(centralColor, 0.82))
      innerGrad.addColorStop(1, hexToRgba(centralColor, 0))
      ctx.beginPath()
      ctx.arc(camX, camY, innerR, 0, Math.PI * 2)
      ctx.fillStyle = innerGrad
      ctx.fill()

      // Two counter-rotating 4-point stellar diffraction rays (8-point shimmer)
      ctx.save()
      ctx.translate(camX, camY)
      ctx.rotate(frame * 0.0012)
      const rayLen = (isSunHot ? 66 : 54) * coreScale
      ctx.strokeStyle = hexToRgba(centralColor, isSunHot ? 0.4 : 0.28)
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(-rayLen, 0)
      ctx.lineTo(rayLen, 0)
      ctx.moveTo(0, -rayLen)
      ctx.lineTo(0, rayLen)
      ctx.stroke()

      ctx.rotate(Math.PI / 4 - frame * 0.0024)
      const subRay = rayLen * 0.56
      ctx.strokeStyle = hexToRgba(centralColor, 0.16)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-subRay, 0)
      ctx.lineTo(subRay, 0)
      ctx.moveTo(0, -subRay)
      ctx.lineTo(0, subRay)
      ctx.stroke()
      ctx.restore()

      // Tiny orbiting solar embers near the corona
      for (let e = 0; e < 6; e++) {
        const ea = (e / 6) * Math.PI * 2 + frame * (0.005 + (e % 2) * 0.002)
        const er = (24 + (e % 3) * 11) * coreScale
        const ex = camX + Math.cos(ea) * er
        const ey = camY + Math.sin(ea) * er * (0.72 + 0.28 * orbitSquashY)
        ctx.beginPath()
        ctx.arc(ex, ey, 1.1 * coreScale, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(centralColor, 0.55)
        ctx.fill()
      }

      // Subtle intro ripple when the star awakens
      if (introProgress < 0.98) {
        const rippleR = 30 + introProgress * 260
        const rippleAlpha = (1 - introProgress) * 0.22
        ctx.beginPath()
        ctx.arc(camX, camY, rippleR, 0, Math.PI * 2)
        ctx.strokeStyle = hexToRgba(centralColor, rippleAlpha)
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Distant miniature galaxies representing other accessible albums/clusters
      const galaxies: Array<{ sys: OtherSystem; x: number; y: number }> = []
      let hotGalaxy: { sys: OtherSystem; x: number; y: number } | null = null
      if (isUnlocked && otherSystemsRef.current.length > 0) {
        const list = otherSystemsRef.current.slice(0, galaxyAnchors.length)
        for (let gi = 0; gi < list.length; gi++) {
          const sys = list[gi]
          const anc = galaxyAnchors[gi]
          const gx = anc.ax * width + (camX - width * 0.5) * 0.14
          const gy = anc.ay * height + (camY - height * 0.5) * 0.14
          galaxies.push({ sys, x: gx, y: gy })

          const gDist =
            mouse.active && !isFocused ? Math.hypot(mouse.x - gx, mouse.y - gy) : Infinity
          const isGHot = gDist < 32
          if (isGHot) hotGalaxy = { sys, x: gx, y: gy }

          const gAlpha = (isGHot ? 0.85 : 0.42) * (1 - focusBlend * 0.8) * introEase
          const gScale = isGHot ? 1.25 : 1

          // Soft galactic halo
          const gGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 28 * gScale)
          gGrad.addColorStop(0, hexToRgba(sys.color, 0.55 * gAlpha))
          gGrad.addColorStop(0.45, hexToRgba(sys.color, 0.18 * gAlpha))
          gGrad.addColorStop(1, hexToRgba(sys.color, 0))
          ctx.beginPath()
          ctx.arc(gx, gy, 28 * gScale, 0, Math.PI * 2)
          ctx.fillStyle = gGrad
          ctx.fill()

          // Miniature tilted spiral arms
          ctx.save()
          ctx.translate(gx, gy)
          ctx.rotate(-0.35 + gi * 0.5)
          ctx.scale(1, 0.48)
          ctx.rotate(frame * 0.004)
          for (let arm = 0; arm < 2; arm++) {
            const baseA = arm * Math.PI
            for (let p = 1; p <= 8; p++) {
              const pa = baseA + p * 0.36
              const pr = p * 2.4 * gScale
              ctx.beginPath()
              ctx.arc(
                Math.cos(pa) * pr,
                Math.sin(pa) * pr,
                (1.1 - p * 0.08) * gScale,
                0,
                Math.PI * 2
              )
              ctx.fillStyle = hexToRgba(sys.color, (0.65 - p * 0.05) * gAlpha)
              ctx.fill()
            }
          }
          ctx.restore()

          // Galactic core dot
          ctx.beginPath()
          ctx.arc(gx, gy, 2.2 * gScale, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * gAlpha})`
          ctx.fill()
        }
      }
      galaxyPosRef.current = galaxies

      // Subtle warp veil when switching systems
      if (warpFade > 0) {
        ctx.fillStyle = `rgba(180, 205, 255, ${warpFade * 0.06})`
        ctx.fillRect(0, 0, width, height)
      }

      // Faint elliptical orbital guides around the central star (tilts into eye-level)
      const isNarrowScreen = Math.min(width, height) < 560
      const guideRadii = isNarrowScreen ? [82, 132, 182] : [145, 245, 355]
      ctx.save()
      for (const gr of guideRadii) {
        const rx = gr * (0.65 + 0.35 * camScale)
        const ry = rx * orbitSquashY
        ctx.beginPath()
        ctx.ellipse(camX, camY, rx, ry, 0, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.032 * (1 - focusBlend * 0.7)})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()

      let nearestHover: StarNode | null = null
      let nearestDist = 24

      for (const node of nodesRef.current) {
        if (node.inOrbit) {
          // Keep orbital radius within current viewport bounds (handles window resize & mobile toggle)
          const maxAllowedOrbit = isNarrowScreen
            ? Math.min(176, Math.min(width, height) * 0.38)
            : Math.min(345, Math.min(width, height) * 0.42)
          const effectiveRadius = Math.min(node.orbitRadius, maxAllowedOrbit)

          // Revolve smoothly around the central star
          node.orbitAngle += node.orbitSpeed
          node.ox = Math.cos(node.orbitAngle) * effectiveRadius
          node.oy = Math.sin(node.orbitAngle) * effectiveRadius

          // Project orbital plane through camera scale & eye-level Y-squash
          const planeScale = 0.65 + 0.35 * camScale
          node.x = camX + node.ox * planeScale
          node.y = camY + node.oy * planeScale * orbitSquashY
        } else {
          // Outer-ring drifting star: drifts slowly in deep space and follows perspective parallax
          node.driftVx += Math.sin(frame * 0.004 + node.twinklePhase) * 0.0000012
          node.driftVy += Math.cos(frame * 0.0035 + node.twinklePhase) * 0.0000012
          const dSpeed = Math.hypot(node.driftVx, node.driftVy)
          if (dSpeed > 0.000075) {
            node.driftVx = (node.driftVx / dSpeed) * 0.000075
            node.driftVy = (node.driftVy / dSpeed) * 0.000075
          }
          node.driftX += node.driftVx
          node.driftY += node.driftVy
          if (node.driftX < 0.07) {
            node.driftX = 0.07
            node.driftVx = Math.abs(node.driftVx)
          } else if (node.driftX > 0.93) {
            node.driftX = 0.93
            node.driftVx = -Math.abs(node.driftVx)
          }
          if (node.driftY < 0.09) {
            node.driftY = 0.09
            node.driftVy = Math.abs(node.driftVy)
          } else if (node.driftY > 0.91) {
            node.driftY = 0.91
            node.driftVy = -Math.abs(node.driftVy)
          }

          node.x = Math.max(
            28,
            Math.min(width - 28, node.driftX * width + (camX - width * 0.5) * 0.36)
          )
          node.y = Math.max(
            28,
            Math.min(height - 28, node.driftY * height + (camY - height * 0.5) * 0.36)
          )
        }

        const activeFilter = filterAuthorRef.current
        const isDimmed =
          Boolean(activeFilter) &&
          Boolean(node.photo?.author_name) &&
          node.photo?.author_name !== activeFilter

        if (isUnlocked && mouse.active && !isDimmed && !isFocused) {
          const d = Math.hypot(mouse.x - node.x, mouse.y - node.y)
          if (d < nearestDist) {
            nearestDist = d
            nearestHover = node
          }
        }

        // Depth cue: stars in front half of tilted ellipse (oy > 0) look slightly brighter & larger
        const depthFactor = 0.85 + 0.25 * (node.oy / Math.max(120, node.orbitRadius)) * (1 - orbitSquashY)
        const pulse = 0.82 + 0.18 * Math.sin(frame * 0.03 + node.twinklePhase)
        const isHot = nearestHover?.id === node.id
        const glowRadius = (isHot ? 34 : 20) * pulse * depthFactor
        const dimFactor = (isDimmed ? 0.16 : 1) * (1 - focusBlend * 0.68) * introEase

        const drawX = node.x + (node.x - width * 0.5) * focusBlend * 0.22
        const drawY = node.y + (node.y - height * 0.5) * focusBlend * 0.22

        if (node.birthProgress < 1) {
          node.birthProgress = Math.min(1, node.birthProgress + 0.0083)
        }
        const bp = node.birthProgress
        const chargePhase = bp < 0.68 ? bp / 0.68 : 1
        const ignitePhase = bp >= 0.68 ? (bp - 0.68) / 0.32 : 0
        const chargeEase = chargePhase * chargePhase // slow accelerating pull inward
        const igniteEase = 1 - Math.pow(1 - ignitePhase, 3) // snappy ignition burst
        const igniteFlash = bp >= 0.68 ? Math.sin(ignitePhase * Math.PI) : 0

        const birthGlowBoost =
          bp < 1
            ? bp < 0.68
              ? chargeEase * 8
              : igniteFlash * 42
            : 0
        const birthAlphaScale =
          bp < 1
            ? bp < 0.68
              ? 0.2 + chargeEase * 0.45
              : 0.65 + 0.35 * igniteEase + igniteFlash * 0.35
            : 1

        const grad = ctx.createRadialGradient(
          drawX,
          drawY,
          0,
          drawX,
          drawY,
          glowRadius * (bp < 0.68 ? 0.5 + chargeEase * 0.5 : 1) + birthGlowBoost
        )
        grad.addColorStop(
          0,
          hexToRgba(
            node.color,
            Math.min(1, (isHot ? 0.95 : 0.72) * birthAlphaScale) * dimFactor
          )
        )
        grad.addColorStop(
          0.35,
          hexToRgba(
            node.color,
            ((isHot ? 0.36 : 0.18) + igniteFlash * 0.28) * birthAlphaScale * dimFactor
          )
        )
        grad.addColorStop(1, hexToRgba(node.color, 0))

        ctx.beginPath()
        ctx.arc(
          drawX,
          drawY,
          glowRadius * (bp < 0.68 ? 0.5 + chargeEase * 0.5 : 1) + birthGlowBoost,
          0,
          Math.PI * 2
        )
        ctx.fillStyle = grad
        ctx.fill()

        // Phase 1 (0 -> 0.68): Slow inward energy gathering
        if (bp < 0.68) {
          const gatherR = 54 * (1 - chargeEase * 0.85)
          ctx.beginPath()
          ctx.arc(drawX, drawY, gatherR, 0, Math.PI * 2)
          ctx.strokeStyle = hexToRgba(node.color, 0.12 + chargeEase * 0.28)
          ctx.lineWidth = 1
          ctx.stroke()

          for (let k = 0; k < 10; k++) {
            const ang = (k / 10) * Math.PI * 2 + node.twinklePhase + chargeEase * 1.4
            const distSpark = (48 + (k % 3) * 12) * (1 - chargeEase * 0.88)
            const sx = drawX + Math.cos(ang) * distSpark
            const sy = drawY + Math.sin(ang) * distSpark * orbitSquashY
            ctx.beginPath()
            ctx.arc(sx, sy, 1.1 + chargeEase * 0.5, 0, Math.PI * 2)
            ctx.fillStyle = hexToRgba(node.color, 0.25 + chargeEase * 0.65)
            ctx.fill()
          }
        }

        // Phase 2 (0.68 -> 1.0): Quick ignition burst & shockwave
        if (bp >= 0.68 && bp < 1) {
          const ringR = 5 + igniteEase * 72
          const ringAlpha = (1 - ignitePhase) * 0.65
          ctx.beginPath()
          ctx.arc(drawX, drawY, ringR, 0, Math.PI * 2)
          ctx.strokeStyle = hexToRgba(node.color, ringAlpha)
          ctx.lineWidth = 1.6 * (1 - ignitePhase * 0.7)
          ctx.stroke()
        }

        // Core
        const coreSizeScale =
          bp < 1
            ? bp < 0.68
              ? 0.35 + chargeEase * 0.35
              : 0.7 + 0.3 * igniteEase + igniteFlash * 0.9
            : 1
        ctx.beginPath()
        ctx.arc(
          drawX,
          drawY,
          node.baseRadius * (isHot ? 1.35 : 1) * pulse * coreSizeScale,
          0,
          Math.PI * 2
        )
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, birthAlphaScale) * dimFactor})`
        ctx.fill()

        // Subtle cross flare (tight during charge, snaps out during ignition)
        const flareLen =
          (isHot ? 15 : 9) * pulse * (bp < 0.68 ? 0.3 + chargeEase * 0.4 : 1) +
          igniteFlash * 28
        ctx.strokeStyle = hexToRgba(
          node.color,
          Math.min(1, ((isHot ? 0.75 : 0.35) + igniteFlash * 0.55) * birthAlphaScale) * dimFactor
        )
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(drawX - flareLen, drawY)
        ctx.lineTo(drawX + flareLen, drawY)
        ctx.moveTo(drawX, drawY - flareLen)
        ctx.lineTo(drawX, drawY + flareLen)
        ctx.stroke()
      }

      const tp = touchPreviewRef.current
      if (tp) {
        if (tp.kind === 'sun') {
          setHoveredSun({ x: camX, y: camY })
        } else if (tp.kind === 'star') {
          const tNode = nodesRef.current.find((n) => n.id === tp.id)
          if (tNode) setHovered({ node: tNode, x: tNode.x, y: tNode.y })
        } else if (tp.kind === 'galaxy') {
          const tGal = galaxies.find((g) => g.sys.id === tp.id)
          if (tGal) setHoveredGalaxy(tGal)
        }
      } else if (isSunHot) {
        canvas.style.cursor = 'pointer'
        setHoveredSun({ x: camX, y: camY })
        setHovered((prev) => (prev ? null : prev))
        setHoveredGalaxy((prev) => (prev ? null : prev))
      } else if (nearestHover) {
        canvas.style.cursor = 'pointer'
        setHoveredSun((prev) => (prev ? null : prev))
        setHoveredGalaxy((prev) => (prev ? null : prev))
        setHovered({
          node: nearestHover,
          x: nearestHover.x,
          y: nearestHover.y,
        })
      } else if (hotGalaxy) {
        canvas.style.cursor = 'pointer'
        setHoveredSun((prev) => (prev ? null : prev))
        setHovered((prev) => (prev ? null : prev))
        setHoveredGalaxy(hotGalaxy)
      } else {
        canvas.style.cursor = 'default'
        setHoveredSun((prev) => (prev ? null : prev))
        setHovered((prev) => (prev ? null : prev))
        setHoveredGalaxy((prev) => (prev ? null : prev))
      }

      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const touchDragRef = useRef<{
    active: boolean
    moved: boolean
    startX: number
    startY: number
    startNormX: number
    startNormY: number
    timer: number | null
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startNormX: 0,
    startNormY: 0,
    timer: null,
  })

  const openMenuAt = (clientX: number, clientY: number) => {
    const menuW = 168
    const menuH = 96
    const x = Math.min(clientX, window.innerWidth - menuW - 12)
    const y = Math.min(clientY, window.innerHeight - menuH - 12)
    setContextMenu({ x, y })
  }

  const lastPointerTypeRef = useRef<string>('mouse')

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    lastPointerTypeRef.current = e.pointerType || 'mouse'
    if (e.pointerType !== 'touch') return
    if (!unlocked || focusedStarId !== null) return
    const td = touchDragRef.current
    if (td.timer) window.clearTimeout(td.timer)
    td.active = true
    td.moved = false
    td.startX = e.clientX
    td.startY = e.clientY
    td.startNormX = lastViewRef.current.normX
    td.startNormY = lastViewRef.current.normY
    td.timer = window.setTimeout(() => {
      if (td.active && !td.moved) {
        openMenuAt(e.clientX, e.clientY)
        td.active = false
      }
    }, 520)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') {
      const td = touchDragRef.current
      if (!td.active || !unlocked || focusedStarId !== null) return
      const dx = e.clientX - td.startX
      const dy = e.clientY - td.startY
      if (Math.hypot(dx, dy) > 8) {
        td.moved = true
        if (td.timer) {
          window.clearTimeout(td.timer)
          td.timer = null
        }
        if (!viewLockedRef.current) {
          // Single-finger drag smoothly tilts perspective and holds it on release
          const nx = Math.max(-1, Math.min(1, td.startNormX - dx / (window.innerWidth * 0.45)))
          const ny = Math.max(-1, Math.min(1, td.startNormY - dy / (window.innerHeight * 0.45)))
          lastViewRef.current = {
            normX: nx,
            normY: ny,
            dist: Math.min(1, Math.hypot(nx, ny)),
          }
        }
      }
      return
    }
    mouseRef.current = { x: e.clientX, y: e.clientY, active: true }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'touch') return
    const td = touchDragRef.current
    if (td.timer) {
      window.clearTimeout(td.timer)
      td.timer = null
    }
    td.active = false
  }

  const handlePointerLeave = () => {
    mouseRef.current.active = false
    setHovered(null)
    setHoveredSun(null)
    setHoveredGalaxy(null)
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!unlocked || focusedStarId !== null) return
    const mx = e.clientX
    const my = e.clientY
    for (const g of galaxyPosRef.current) {
      if (Math.hypot(mx - g.x, my - g.y) < 34) {
        setHoveredGalaxy(null)
        onSwitchCluster?.(g.sys.id)
        return
      }
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!unlocked) return
    if (touchDragRef.current.moved) {
      touchDragRef.current.moved = false
      return
    }
    const mx = e.clientX
    const my = e.clientY

    const sunDist = Math.hypot(mx - camPosRef.current.x, my - camPosRef.current.y)
    const isTouchOrMobile =
      lastPointerTypeRef.current === 'touch' ||
      window.matchMedia('(pointer: coarse)').matches

    if (sunDist < Math.max(28, 40 * camPosRef.current.scale)) {
      if (isTouchOrMobile && touchPreview?.kind !== 'sun') {
        setTouchPreview({ kind: 'sun' })
        setHoveredSun({ x: camPosRef.current.x, y: camPosRef.current.y })
        setHovered(null)
        setHoveredGalaxy(null)
        return
      }
      setTouchPreview(null)
      setHoveredSun(null)
      onSelectSun?.()
      return
    }

    if (isTouchOrMobile) {
      for (const g of galaxyPosRef.current) {
        if (Math.hypot(mx - g.x, my - g.y) < 36) {
          if (touchPreview?.kind !== 'galaxy' || touchPreview.id !== g.sys.id) {
            setTouchPreview({ kind: 'galaxy', id: g.sys.id })
            setHoveredGalaxy(g)
            setHovered(null)
            setHoveredSun(null)
            return
          }
          setTouchPreview(null)
          setHoveredGalaxy(null)
          onSwitchCluster?.(g.sys.id)
          return
        }
      }
    }

    let best: StarNode | null = null
    let bestD = isTouchOrMobile ? 36 : 28
    for (const node of nodesRef.current) {
      const d = Math.hypot(mx - node.x, my - node.y)
      if (d < bestD) {
        bestD = d
        best = node
      }
    }
    if (best) {
      if (isTouchOrMobile && (touchPreview?.kind !== 'star' || touchPreview.id !== best.id)) {
        setTouchPreview({ kind: 'star', id: best.id })
        setHovered({ node: best, x: best.x, y: best.y })
        setHoveredSun(null)
        setHoveredGalaxy(null)
        return
      }
      setTouchPreview(null)
      setHovered(null)
      onSelectStar(best.id)
      return
    }

    // Tapping empty sky clears any touch preview tooltip
    if (isTouchOrMobile && touchPreview) {
      setTouchPreview(null)
      setHovered(null)
      setHoveredSun(null)
      setHoveredGalaxy(null)
    }
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!unlocked || focusedStarId !== null) return
    e.preventDefault()
    openMenuAt(e.clientX, e.clientY)
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="starfield-canvas"
        data-cursor={hovered || hoveredSun || hoveredGalaxy ? 'pointer' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {unlocked && hoveredGalaxy && (
        <div
          className="star-tooltip liquid-glass"
          style={{ left: hoveredGalaxy.x, top: hoveredGalaxy.y }}
        >
          <div className="star-tooltip-meta">
            <span className="star-tooltip-author">
              <span
                className="star-dot"
                style={{ backgroundColor: hoveredGalaxy.sys.color }}
              />
              {hoveredGalaxy.sys.name}
            </span>
            <span className="star-tooltip-date">双击跃迁到此星系</span>
          </div>
        </div>
      )}

      {unlocked && contextMenu && (
        <div
          className="liquid-glass"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 35,
            minWidth: 156,
            padding: 6,
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <button
            type="button"
            className="glass-pill-btn"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              padding: '8px 12px',
              fontSize: 13,
              borderRadius: 11,
              border: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
            onClick={() => {
              setViewLocked((v) => !v)
              setContextMenu(null)
            }}
          >
            {viewLocked ? <Unlock size={14} /> : <Lock size={14} />}
            <span>{viewLocked ? '解锁视角跟随' : '锁定当前视角'}</span>
          </button>
          <button
            type="button"
            className="glass-pill-btn"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              padding: '8px 12px',
              fontSize: 13,
              borderRadius: 11,
              border: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
            onClick={() => {
              lastViewRef.current = { normX: 0, normY: 0, dist: 0 }
              setViewLocked(false)
              setContextMenu(null)
            }}
          >
            <RotateCcw size={14} />
            <span>恢复俯视中心</span>
          </button>
        </div>
      )}

      {unlocked && hoveredSun && (
        <div
          className="star-tooltip liquid-glass"
          style={{ left: hoveredSun.x, top: hoveredSun.y }}
        >
          {sunConfig?.photo && <img src={sunConfig.photo.url} alt="" />}
          <div className="star-tooltip-meta">
            <span className="star-tooltip-author">
              <span className="star-dot" style={{ backgroundColor: accentColor }} />
              {sunConfig?.photo ? '恒星记忆' : '中央恒星'}
            </span>
            <span className="star-tooltip-date">
              {sunConfig?.met_at
                ? formatMetDays(sunConfig.met_at)
                : '点击设定照片与相识时间'}
            </span>
          </div>
        </div>
      )}

      {unlocked && hovered && hovered.node.photo && (
        <div
          className="star-tooltip liquid-glass"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <img src={hovered.node.photo.url} alt="" />
          <div className="star-tooltip-meta">
            <span className="star-tooltip-author">
              <span
                className="star-dot"
                style={{ backgroundColor: hovered.node.color }}
              />
              {hovered.node.photo.author_name}
            </span>
            <span className="star-tooltip-date">
              {hovered.node.photo.taken_at}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
