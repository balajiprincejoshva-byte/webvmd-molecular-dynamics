import React, { useEffect, useState } from 'react'
import Link from 'next/link'

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Home() {
  const [datasets, setDatasets] = useState<any[]>([])

  useEffect(() => {
    fetch(`${apiBase}/api/datasets`).then((r) => r.json()).then((j) => setDatasets(j.datasets || []))
  }, [])

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">WebVMD — Molecular Dynamics in the Browser</h1>
        <p className="mb-6 text-gray-600">Select a dataset to explore. Datasets are served from the FastAPI backend and frames are streamed to the viewer.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {datasets.map((d) => (
            <div key={d.id} className="p-4 border rounded bg-white">
              <h2 className="font-medium">{d.name}</h2>
              <p className="text-sm text-gray-500">Atoms: {d.n_atoms} • Frames: {d.n_frames}</p>
              <div className="mt-3">
                <Link href={`/viewer/${encodeURIComponent(d.id)}`} className="px-3 py-1 bg-indigo-600 text-white rounded">
                  Open Viewer
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
