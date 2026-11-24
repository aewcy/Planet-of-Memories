import React, { useEffect, useState } from 'react'
import { BookOpen, Camera, LogOut, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import {
  api,
  type AuthorUser,
  clearPasscode,
  type ClusterInfo,
  getSavedPasscode,
  type PhotoItem,
  type PublicConfig,
  type PublicStar,
  savePasscode,
  type SunConfig,
} from './api'
import { AdminPanelModal } from './components/AdminPanelModal'
import { CustomCursor } from './components/CustomCursor'
import { MemoryModal } from './components/MemoryModal'
import { PhotoStackModal } from './components/PhotoStackModal'
import { StarfieldCanvas } from './components/StarfieldCanvas'
import { SunModal } from './components/SunModal'
import { UserClusterModal } from './components/UserClusterModal'
import { compressImage } from './utils/imageCompress'

const ACTIVE_CLUSTER_STORAGE_KEY = 'planet_active_cluster_id'

const AMBIENT_ENTRY_STARS: PublicStar[] = [
  { id: -1, taken_at: '2026-01-01', author_color: '#89b4fa' },
  { id: -2, taken_at: '2026-02-01', author_color: '#f6c177' },
  { id: -3, taken_at: '2026-03-01', author_color: '#94e2d5' },
  { id: -4, taken_at: '2026-04-01', author_color: '#cba6f7' },
  { id: -5, taken_at: '2026-05-01', author_color: '#f5c2e7' },
  { id: -6, taken_at: '2026-06-01', author_color: '#89b4fa' },
]

function formatLocalDateTimeInput(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [currentUser, setCurrentUser] = useState<AuthorUser | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [showLoginGate, setShowLoginGate] = useState(false)
  const [passcodeInput, setPasscodeInput] = useState('')
  const [authError, setAuthError] = useState('')

  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteInfo, setInviteInfo] = useState<{ id: number; name: string } | null>(null)
  const [inviteError, setInviteError] = useState('')

  const [clusters, setClusters] = useState<ClusterInfo[]>([])
  const [activeClusterId, setActiveClusterId] = useState<number>(0)

  const [publicStars, setPublicStars] = useState<PublicStar[]>([])
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const [isClosingStack, setIsClosingStack] = useState(false)
  const [bornStarId, setBornStarId] = useState<number | null>(null)
  const [sunConfig, setSunConfig] = useState<SunConfig>({ met_at: '', photo: null })
  const [showSunModal, setShowSunModal] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  const [filterAuthor, setFilterAuthor] = useState<string | null>(null)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [showClusterModal, setShowClusterModal] = useState(false)
  const [showMemoryModal, setShowMemoryModal] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Upload Modal
  const [showUpload, setShowUpload] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [takenAtInput, setTakenAtInput] = useState(formatLocalDateTimeInput())
  const [inOrbitInput, setInOrbitInput] = useState(true)
  const [isHiddenInput, setIsHiddenInput] = useState(false)
  const [surpriseNoteInput, setSurpriseNoteInput] = useState('')
  const [discoverBurstId, setDiscoverBurstId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)

  const applyAuthResult = (res: {
    user: AuthorUser
    clusters: ClusterInfo[]
    invited_cluster_id: number | null
  }) => {
    setCurrentUser(res.user)
    setClusters(res.clusters)
    const rawSaved = window.localStorage.getItem(ACTIVE_CLUSTER_STORAGE_KEY)
    const savedId = rawSaved !== null && rawSaved !== '' ? Number(rawSaved) : NaN
    const hasSavedAccess =
      Number.isInteger(savedId) &&
      (savedId === 0 || res.clusters.some((c) => c.id === savedId))
    const targetClusterId =
      res.invited_cluster_id ?? (hasSavedAccess ? savedId : res.clusters[0]?.id ?? 0)
    setActiveClusterId(targetClusterId)
    setUnlocked(true)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const inv = params.get('invite')?.trim() || null
    setInviteCode(inv)

    if (inv) {
      api
        .getInviteInfo(inv)
        .then((info) => {
          setInviteInfo(info)
          api.listPublicStars(inv).then(setPublicStars).catch(console.error)
        })
        .catch((err) => {
          setInviteError(err.message || '邀请链接无效')
        })
    }

    api
      .getConfig()
      .then(async (cfg) => {
        setConfig(cfg)
        const saved = getSavedPasscode()
        if (saved) {
          try {
            const res = await api.verifyPasscode(saved, inv)
            applyAuthResult(res)
          } catch {
            clearPasscode()
          }
        }
      })
      .catch(console.error)
  }, [])

  const loadPhotos = async (clusterId: number) => {
    try {
      const [list, sun] = await Promise.all([
        api.listPhotos(clusterId, 'asc'),
        api.getSunConfig(clusterId),
      ])
      setPhotos(list)
      setSunConfig(sun)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (unlocked) {
      window.localStorage.setItem(ACTIVE_CLUSTER_STORAGE_KEY, String(activeClusterId))
      loadPhotos(activeClusterId)
    }
  }, [unlocked, activeClusterId])

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    try {
      const res = await api.verifyPasscode(passcodeInput, inviteCode)
      savePasscode(passcodeInput.trim())
      applyAuthResult(res)
      setPasscodeInput('')
    } catch (err: any) {
      setAuthError(err.message || '生日暗号不对哦')
    }
  }

  const handleSaveFirstName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameInput.trim() || savingName) return
    setSavingName(true)
    try {
      const updatedUser = await api.setDisplayName(nameInput.trim())
      setCurrentUser(updatedUser)
      setNameInput('')
      const cfg = await api.getConfig()
      setConfig(cfg)
      await refreshClustersForUser()
      await loadPhotos(activeClusterId)
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally {
      setSavingName(false)
    }
  }

  const handleSwitchIdentity = () => {
    clearPasscode()
    window.localStorage.removeItem(ACTIVE_CLUSTER_STORAGE_KEY)
    setUnlocked(false)
    setShowLoginGate(false)
    setCurrentUser(null)
    setClusters([])
    setActiveClusterId(0)
    setSelectedPhotoId(null)
    setFilterAuthor(null)
    if (inviteCode) {
      api.listPublicStars(inviteCode).then(setPublicStars).catch(console.error)
    } else {
      setPublicStars([])
    }
  }

  const refreshClustersForUser = async () => {
    const saved = getSavedPasscode()
    if (!saved) return
    try {
      const res = await api.verifyPasscode(saved, inviteCode)
      setClusters(res.clusters)
      if (!activeClusterId && res.clusters[0]) {
        setActiveClusterId(res.clusters[0].id)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile || uploading) return
    setUploading(true)
    try {
      const compressed = await compressImage(selectedFile)
      const formattedTime = takenAtInput.replace('T', ' ')
      const created = await api.uploadPhoto(
        compressed,
        formattedTime,
        '',
        activeClusterId,
        isHiddenInput ? false : inOrbitInput,
        isHiddenInput,
        isHiddenInput ? surpriseNoteInput.trim() : ''
      )
      setShowUpload(false)
      setSelectedFile(null)
      setPreviewUrl('')
      setInOrbitInput(true)
      setIsHiddenInput(false)
      setSurpriseNoteInput('')
      setBornStarId(created.id)
      await loadPhotos(activeClusterId)
    } catch (err: any) {
      alert(err.message || '上传失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  const activeCluster = clusters.find((c) => c.id === activeClusterId) || null
  const otherSystems = unlocked
    ? [
        { id: 0, name: '我的星空', color: currentUser?.color || '#f6c177' },
        ...clusters.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.members?.[0]?.color || '#89b4fa',
        })),
      ].filter((s) => s.id !== activeClusterId)
    : []

  const entryStars = publicStars.length > 0 ? publicStars : AMBIENT_ENTRY_STARS

  const normalPhotos = photos.filter((p) => !p.is_hidden)
  const selectedPhoto =
    selectedPhotoId !== null ? photos.find((p) => p.id === selectedPhotoId) ?? null : null
  const modalPhotos = selectedPhoto?.is_hidden ? [selectedPhoto] : normalPhotos

  const handleSelectStar = async (id: number) => {
    setIsClosingStack(false)
    const target = photos.find((p) => p.id === id)
    if (
      target?.is_hidden &&
      !target.is_discovered &&
      target.author_name !== currentUser?.name &&
      !currentUser?.is_admin
    ) {
      setDiscoverBurstId(id)
      try {
        const updated = await api.discoverPhoto(id)
        setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)))
      } catch (err) {
        console.error(err)
      }
      window.setTimeout(() => {
        setSelectedPhotoId(id)
      }, 340)
      return
    }
    setSelectedPhotoId(id)
  }

  return (
    <div
      className="starfield-stage"
      onClick={() => {
        if (!unlocked && !showLoginGate) {
          setShowLoginGate(true)
        }
      }}
    >
      <CustomCursor accentColor={currentUser?.color} />
      <StarfieldCanvas
        stars={unlocked ? photos : entryStars}
        unlocked={unlocked}
        accentColor={currentUser?.color || '#f6c177'}
        currentUserName={currentUser?.name}
        isAdmin={Boolean(currentUser?.is_admin)}
        focusedStarId={isClosingStack ? null : selectedPhotoId}
        bornStarId={bornStarId}
        discoverBurstId={discoverBurstId}
        sunConfig={sunConfig}
        otherSystems={otherSystems}
        activeClusterId={activeClusterId}
        nebulaOpacity={config?.effects?.nebula_opacity ?? 1.0}
        filterAuthor={config?.effects?.allow_author_filter ? filterAuthor : null}
        onSelectStar={handleSelectStar}
        onSelectSun={() => setShowSunModal(true)}
        onSwitchCluster={(id) => {
          setActiveClusterId(id)
          setFilterAuthor(null)
          setSelectedPhotoId(null)
        }}
      />

      {/* Quiet entry prompt before clicking to reveal login */}
      {!unlocked && !showLoginGate && config && (
        <div className="entry-whisper">
          {inviteInfo ? `受邀加入「${inviteInfo.name}」 · 轻触星空进入` : '轻触星空进入'}
        </div>
      )}

      {/* Apple Liquid Glass Passcode Gate */}
      {!unlocked && showLoginGate && config && (
        <div
          className="gate-overlay"
          onClick={() => setShowLoginGate(false)}
        >
          <div
            className="gate-glass-card liquid-glass"
            onClick={(e) => e.stopPropagation()}
          >
            {inviteInfo && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 10,
                }}
              >
                受邀加入「{inviteInfo.name}」
              </div>
            )}
            {inviteError && (
              <p className="gate-error" style={{ marginBottom: 12 }}>
                {inviteError}
              </p>
            )}
            <h1 className="gate-title" style={{ marginBottom: 22 }}>
              {config.effects?.gate_title || '点亮今夜的星'}
            </h1>
            <form className="gate-form" onSubmit={handleUnlock}>
              <input
                type="password"
                className="glass-input"
                style={{ textAlign: 'center', letterSpacing: '0.18em' }}
                placeholder="输入生日暗号"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                autoFocus
              />
              {authError && <p className="gate-error">{authError}</p>}
              <button type="submit" className="glass-pill-btn">
                进入
              </button>
            </form>
          </div>
        </div>
      )}

      {/* First-login display name setup */}
      {unlocked && currentUser?.needs_name_setup && (
        <div className="gate-overlay">
          <div className="gate-glass-card liquid-glass">
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginBottom: 12,
              }}
            >
              <span className="star-dot" style={{ backgroundColor: currentUser.color }} />
              <span>你的专属星光</span>
            </div>
            <h1 className="gate-title" style={{ marginBottom: 22 }}>
              怎么称呼你
            </h1>
            <form className="gate-form" onSubmit={handleSaveFirstName}>
              <input
                className="glass-input"
                style={{ textAlign: 'center' }}
                placeholder="输入你的名字"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="glass-pill-btn"
                disabled={!nameInput.trim() || savingName}
              >
                {savingName ? '进入中…' : '进入星空'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSwitchIdentity()
                  setNameInput('')
                  setPasscodeInput('')
                  setAuthError('')
                  setShowLoginGate(true)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  marginTop: 2,
                }}
              >
                ← 返回重输暗号
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Minimal HUD when unlocked */}
      {unlocked && config && !currentUser?.needs_name_setup && (
        <>
          <header className="hud-bar">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <button
                className="glass-pill-btn"
                style={{ padding: '8px 13px', fontSize: 13 }}
                onClick={() => setShowLegend((v) => !v)}
                title={showLegend ? '收起星图信息' : '查看星群信息'}
              >
                <Sparkles size={14} color={currentUser?.color || '#f6c177'} />
                <span>{filterAuthor ? filterAuthor : normalPhotos.length}</span>
              </button>

              {showLegend && (
                <div className="hud-brand liquid-glass">
                  <div
                    className="hud-title-row"
                    style={{ justifyContent: 'space-between', width: '100%' }}
                  >
                    <span>
                      {activeCluster ? activeCluster.name : '我的星空'} · {normalPhotos.length} 颗星
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLegend(false)
                        setShowClusterModal(true)
                      }}
                      style={{
                        fontSize: 11,
                        padding: '3px 9px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      新建 / 邀请
                    </button>
                  </div>

                  {clusters.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveClusterId(0)
                          setFilterAuthor(null)
                        }}
                        style={{
                          padding: '3px 9px',
                          borderRadius: 999,
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          background:
                            activeClusterId === 0
                              ? 'rgba(255,255,255,0.16)'
                              : 'rgba(255,255,255,0.04)',
                          border:
                            activeClusterId === 0
                              ? '1px solid rgba(255,255,255,0.34)'
                              : '1px solid rgba(255,255,255,0.1)',
                          cursor: 'pointer',
                        }}
                      >
                        我的星空
                      </button>
                      {clusters.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setActiveClusterId(c.id)
                            setFilterAuthor(null)
                          }}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 999,
                            fontSize: 12,
                            color: 'var(--text-primary)',
                            background:
                              c.id === activeClusterId
                                ? 'rgba(255,255,255,0.16)'
                                : 'rgba(255,255,255,0.04)',
                            border:
                              c.id === activeClusterId
                                ? '1px solid rgba(255,255,255,0.34)'
                                : '1px solid rgba(255,255,255,0.1)',
                            cursor: 'pointer',
                          }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="hud-legend">
                    {(activeCluster
                      ? activeCluster.members || []
                      : currentUser
                      ? [{ name: currentUser.name, color: currentUser.color }]
                      : []
                    ).map((a) => {
                      const canFilter = config.effects?.allow_author_filter
                      const isSelected = filterAuthor === a.name
                      return (
                        <button
                          key={a.name}
                          type="button"
                          onClick={() => {
                            if (!canFilter) return
                            setFilterAuthor((prev) => (prev === a.name ? null : a.name))
                          }}
                          className="hud-legend-item"
                          style={{
                            background: isSelected ? 'rgba(255,255,255,0.14)' : 'transparent',
                            border: isSelected
                              ? '1px solid rgba(255,255,255,0.32)'
                              : '1px solid transparent',
                            borderRadius: 999,
                            padding: '3px 8px',
                            color: 'inherit',
                            cursor: canFilter ? 'pointer' : 'default',
                          }}
                          title={canFilter ? `只看 ${a.name} 的星星` : undefined}
                        >
                          <span className="star-dot" style={{ backgroundColor: a.color }} />
                          <span>
                            {a.name}
                            {currentUser?.name === a.name ? '（我）' : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="glass-pill-btn"
                onClick={() => {
                  setTakenAtInput(formatLocalDateTimeInput())
                  setShowUpload(true)
                }}
              >
                <span>{config.effects?.upload_label || '拾光入星'}</span>
              </button>
              <button
                className="glass-pill-btn"
                style={{ padding: '10px 12px' }}
                onClick={() => setShowMemoryModal(true)}
                title="记录者对你的印象"
              >
                <BookOpen size={15} />
              </button>
              {currentUser?.is_admin && (
                <button
                  className="glass-pill-btn"
                  style={{ padding: '10px 12px' }}
                  onClick={() => setShowAdminPanel(true)}
                  title="星群与效果管理"
                >
                  <SlidersHorizontal size={15} />
                </button>
              )}
              {config.requires_passcode && (
                <button
                  className="glass-pill-btn"
                  style={{ padding: '10px 12px' }}
                  onClick={handleSwitchIdentity}
                  title="切换生日身份"
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
          </header>

          {photos.length === 0 && (
            <div className="hud-hint liquid-glass">
              夜空还是黑的，点击右上角「{config.effects?.upload_label || '拾光入星'}」放进第一张照片
            </div>
          )}
        </>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="modal-backdrop" onClick={() => !uploading && setShowUpload(false)}>
          <div
            className="upload-glass-modal liquid-glass"
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
                化作一颗新星
              </h3>
              <button
                className="glass-pill-btn"
                style={{ padding: 7 }}
                onClick={() => !uploading && setShowUpload(false)}
              >
                <X size={15} />
              </button>
            </div>

            <form
              onSubmit={handleUploadSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <label
                style={{
                  border: '1px dashed rgba(255,255,255,0.25)',
                  borderRadius: 16,
                  padding: previewUrl ? 8 : 30,
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
                    alt="预览"
                    style={{
                      width: '100%',
                      maxHeight: 250,
                      objectFit: 'cover',
                      borderRadius: 10,
                    }}
                  />
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                    <Camera
                      size={26}
                      style={{
                        marginBottom: 8,
                        color: currentUser?.color || '#f6c177',
                      }}
                    />
                    <div>点击选择照片（自动压缩）</div>
                  </div>
                )}
              </label>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  照片时间
                </label>
                <input
                  type="datetime-local"
                  className="glass-input"
                  value={takenAtInput}
                  onChange={(e) => setTakenAtInput(e.target.value)}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  cursor: isHiddenInput ? 'not-allowed' : 'pointer',
                  opacity: isHiddenInput ? 0.55 : 1,
                  fontSize: 13,
                }}
              >
                <div>
                  <div>在星系内旋转</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {isHiddenInput ? '隐藏惊喜星默认静静藏在外环深空' : '关闭则在外环深空缓缓漂流'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isHiddenInput ? false : inOrbitInput}
                  disabled={isHiddenInput}
                  onChange={(e) => setInOrbitInput(e.target.checked)}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: isHiddenInput ? 'rgba(246, 193, 119, 0.08)' : 'rgba(255,255,255,0.04)',
                  border: isHiddenInput
                    ? '1px solid rgba(246, 193, 119, 0.35)'
                    : '1px solid rgba(255,255,255,0.12)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <div>
                  <div>设为隐藏惊喜星</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    伪装成微弱星尘，指针靠近时会悄悄闪烁回应
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isHiddenInput}
                  onChange={(e) => setIsHiddenInput(e.target.checked)}
                />
              </label>

              {isHiddenInput && (
                <textarea
                  rows={3}
                  className="glass-input"
                  placeholder="写一句藏在星星里的悄悄话（对方找到并点开时会看到）…"
                  value={surpriseNoteInput}
                  onChange={(e) => setSurpriseNoteInput(e.target.value)}
                  style={{
                    borderRadius: 14,
                    padding: '10px 14px',
                    resize: 'vertical',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                />
              )}

              <button
                type="submit"
                className="glass-pill-btn"
                disabled={!selectedFile || uploading}
              >
                {uploading ? '正在点亮星光并唤醒记录者…' : '放进夜空'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Stacked Photo Deck & Zoomed Chronicler Modal */}
      {selectedPhotoId !== null && modalPhotos.length > 0 && (
        <PhotoStackModal
          photos={modalPhotos}
          initialPhotoId={selectedPhotoId}
          onStartClose={() => setIsClosingStack(true)}
          onClose={() => {
            setSelectedPhotoId(null)
            setIsClosingStack(false)
          }}
          onPhotoUpdated={(updated) =>
            setPhotos((prev) =>
              prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
            )
          }
          onPhotoDeleted={(deletedId) =>
            setPhotos((prev) => prev.filter((p) => p.id !== deletedId))
          }
        />
      )}

      {/* Central Sun Photo & Met-Date Modal */}
      {showSunModal && (
        <SunModal
          clusterId={activeClusterId}
          sunConfig={sunConfig}
          accentColor={currentUser?.color || '#f6c177'}
          onUpdated={(next) => setSunConfig(next)}
          onClose={() => setShowSunModal(false)}
        />
      )}

      {/* User Cluster & Invite Modal */}
      {showClusterModal && (
        <UserClusterModal
          activeClusterId={activeClusterId}
          onSelectCluster={(id) => {
            setActiveClusterId(id)
            setFilterAuthor(null)
          }}
          onClustersChanged={refreshClustersForUser}
          onClose={() => setShowClusterModal(false)}
        />
      )}

      {/* User Memory Viewer & Editor Modal */}
      {showMemoryModal && (
        <MemoryModal
          userName={currentUser?.name || '我'}
          onClose={() => setShowMemoryModal(false)}
        />
      )}

      {/* Admin Effects & Cluster Invite Panel */}
      {showAdminPanel && config && (
        <AdminPanelModal
          effects={config.effects}
          onClose={() => setShowAdminPanel(false)}
          onUpdated={(next) => {
            setConfig((prev) => (prev ? { ...prev, effects: next } : prev))
            if (!next.allow_author_filter) setFilterAuthor(null)
          }}
          onClustersChanged={refreshClustersForUser}
        />
      )}
    </div>
  )
}
