const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function listDatasets() {
  const res = await fetch(`${API_BASE}/api/datasets`)
  return res.json()
}

export async function getMetadata(id: string) {
  const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(id)}/metadata`)
  return res.json()
}

export async function getAtoms(id: string) {
  const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(id)}/atoms`)
  return res.json()
}

export async function fetchFrameBinary(id: string, idx: number) {
  const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(id)}/frames/${idx}?binary=true`)
  const buf = await res.arrayBuffer()
  return new Float32Array(buf)
}
