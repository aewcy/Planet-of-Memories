export interface AuthorUser {
  name: string
  color: string
  is_admin?: boolean
  needs_name_setup?: boolean
}

export interface ClusterInfo {
  id: number
  name: string
  invite_code: string
  is_active: boolean
  members?: Array<{ name: string; color: string }>
}

export interface AdminClusterMember {
  passcode: string
  name: string
  color: string
}

export interface AdminCluster extends ClusterInfo {
  photo_count: number
  members: AdminClusterMember[]
}

export interface SiteEffects {
  allow_author_filter: boolean
  gravity_strength: number
  nebula_opacity: number
  gate_title: string
  upload_label: string
}

export interface PublicConfig {
  requires_passcode: boolean
  authors: AuthorUser[]
  sender_name: string
  ai_enabled: boolean
  effects: SiteEffects
}

export interface PublicStar {
  id: number
  taken_at: string
  author_color: string
}

export interface SunConfig {
  met_at: string
  photo: PhotoItem | null
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface PhotoItem {
  id: number
  cluster_id: number
  filename: string
  url: string
  caption: string
  taken_at: string
  created_at: string
  is_sealed: boolean
  in_orbit?: boolean
  tilt: number
  author_name: string
  author_color: string
  message_count: number
  messages?: ChatMessage[]
}

const PASSCODE_STORAGE_KEY = 'polaroid_chronicle_passcode'

export function getSavedPasscode(): string {
  return localStorage.getItem(PASSCODE_STORAGE_KEY) || ''
}

export function savePasscode(code: string): void {
  localStorage.setItem(PASSCODE_STORAGE_KEY, code)
}

export function clearPasscode(): void {
  localStorage.removeItem(PASSCODE_STORAGE_KEY)
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  const code = getSavedPasscode()
  if (code) {
    headers.set('X-Passcode', code)
  }

  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  getConfig: () => request<PublicConfig>('/api/config'),

  getInviteInfo: (inviteCode: string) =>
    request<{ id: number; name: string; invite_code: string }>(
      `/api/invite/${encodeURIComponent(inviteCode)}`
    ),

  listPublicStars: (inviteCode?: string | null) =>
    request<PublicStar[]>(
      inviteCode ? `/api/stars?invite_code=${encodeURIComponent(inviteCode)}` : '/api/stars'
    ),

  verifyPasscode: (passcode: string, inviteCode?: string | null) =>
    request<{
      ok: boolean
      user: AuthorUser
      clusters: ClusterInfo[]
      invited_cluster_id: number | null
    }>('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, invite_code: inviteCode || undefined }),
    }),

  listPhotos: (clusterId: number, order: 'asc' | 'desc' = 'asc') =>
    request<PhotoItem[]>(`/api/photos?cluster_id=${clusterId}&order=${order}`),

  uploadPhoto: (
    file: File,
    takenAt: string,
    caption: string,
    clusterId: number,
    inOrbit = true
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('cluster_id', String(clusterId))
    form.append('in_orbit', String(inOrbit))
    if (takenAt) form.append('taken_at', takenAt)
    if (caption) form.append('caption', caption)
    return request<PhotoItem>('/api/photos', {
      method: 'POST',
      body: form,
    })
  },

  getPhotoDetail: (id: number) => request<PhotoItem>(`/api/photos/${id}`),

  updatePhoto: (
    id: number,
    data: { caption?: string; taken_at?: string; is_sealed?: boolean; in_orbit?: boolean }
  ) =>
    request<PhotoItem>(`/api/photos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deletePhoto: (id: number) =>
    request<{ ok: boolean }>(`/api/photos/${id}`, { method: 'DELETE' }),

  sendChat: (id: number, message: string) =>
    request<ChatMessage>(`/api/photos/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),

  sealPhoto: (id: number) =>
    request<PhotoItem>(`/api/photos/${id}/seal`, { method: 'POST' }),

  updateSiteEffects: (data: Partial<SiteEffects>) =>
    request<SiteEffects>('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  listAdminClusters: () => request<AdminCluster[]>('/api/admin/clusters'),

  listMyClusters: () =>
    request<
      Array<
        ClusterInfo & {
          photo_count: number
          members: Array<{ name: string; color: string }>
        }
      >
    >('/api/clusters'),

  createMyCluster: (name: string) =>
    request<
      ClusterInfo & {
        photo_count: number
        members: Array<{ name: string; color: string }>
      }
    >('/api/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  updateMyCluster: (id: number, data: { name?: string; is_active?: boolean }) =>
    request<ClusterInfo>(`/api/clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  setDisplayName: (name: string) =>
    request<AuthorUser>('/api/profile/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  getSunConfig: (clusterId: number) =>
    request<SunConfig>(`/api/sun?cluster_id=${clusterId}`),

  saveSunConfig: (clusterId: number, metAt: string, file?: File | null) => {
    const form = new FormData()
    form.append('cluster_id', String(clusterId))
    form.append('met_at', metAt)
    if (file) form.append('file', file)
    return request<SunConfig>('/api/sun', {
      method: 'POST',
      body: form,
    })
  },

  createAdminCluster: (name: string) =>
    request<AdminCluster>('/api/admin/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  updateAdminCluster: (
    id: number,
    data: { name?: string; is_active?: boolean }
  ) =>
    request<ClusterInfo>(`/api/admin/clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
}
