import React, { useEffect, useState } from 'react'
import Link from 'next/link'

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Home() {
  const [datasets, setDatasets] = useState<any[]>([])
  const [showImport, setShowImport] = useState(false)
  const [topologyFile, setTopologyFile] = useState<File | null>(null)
  const [trajectoryFile, setTrajectoryFile] = useState<File | null>(null)
  const [datasetName, setDatasetName] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/datasets`).then((r) => r.json()).then((j) => setDatasets(j.datasets || []))
  }, [])

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    if (!topologyFile || !trajectoryFile) return
    const formData = new FormData()
    formData.append('topology', topologyFile)
    formData.append('trajectory', trajectoryFile)
    const nameToUse = datasetName || topologyFile.name.split('.')[0]

    setImportStatus('Uploading...')
    try {
      const res = await fetch(`${apiBase}/api/datasets/import?name=${encodeURIComponent(nameToUse)}&background=true`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      
      const jobId = data.job_id
      setImportStatus('Processing on server...')
      
      const iv = setInterval(async () => {
        const jRes = await fetch(`${apiBase}/api/datasets/import/${jobId}`)
        if (jRes.ok) {
          const jData = await jRes.json()
          if (jData.status === 'completed') {
            clearInterval(iv)
            setImportStatus('Complete! Reloading datasets...')
            setTimeout(() => {
                window.location.reload()
            }, 1500)
          } else if (jData.status === 'failed') {
            clearInterval(iv)
            setImportStatus(`Failed: ${jData.error || jData.message}`)
          }
        }
      }, 2000)
    } catch (e: any) {
       setImportStatus(`Error: ${e.message}`)
    }
  }

  return (
    <div className="min-h-screen p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-semibold">WebVMD — Molecular Dynamics in the Browser</h1>
          <button 
            onClick={() => setShowImport(!showImport)}
            className="px-4 py-2 bg-indigo-100 text-indigo-700 font-medium rounded hover:bg-indigo-200 transition"
          >
            {showImport ? 'Cancel Import' : 'Import New Dataset'}
          </button>
        </div>
        
        <p className="mb-6 text-gray-600">Select a dataset to explore. Datasets are served from the FastAPI backend and frames are streamed to the viewer.</p>

        {showImport && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 mb-8">
            <h2 className="text-xl font-medium mb-4">Import Real Trajectory</h2>
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dataset Name (Optional)</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 border rounded" 
                  placeholder="e.g., SARS-CoV-2 Spike"
                  value={datasetName}
                  onChange={e => setDatasetName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Topology (.pdb)</label>
                  <input 
                    type="file" 
                    required
                    accept=".pdb"
                    className="w-full text-sm"
                    onChange={e => setTopologyFile(e.target.files ? e.target.files[0] : null)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trajectory (.dcd, .xtc)</label>
                  <input 
                    type="file" 
                    required
                    accept=".dcd,.xtc"
                    className="w-full text-sm"
                    onChange={e => setTrajectoryFile(e.target.files ? e.target.files[0] : null)}
                  />
                </div>
              </div>
              <button 
                type="submit" 
                disabled={!topologyFile || !trajectoryFile || !!importStatus}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                Upload and Import
              </button>
              {importStatus && <p className="text-sm font-medium text-indigo-600 mt-2">{importStatus}</p>}
            </form>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {datasets.map((d) => (
            <div key={d.id} className="p-5 border rounded-lg bg-white shadow-sm hover:shadow-md transition">
              <h2 className="font-semibold text-lg">{d.name}</h2>
              <p className="text-sm text-gray-500 mt-1">Atoms: {d.n_atoms} • Frames: {d.n_frames}</p>
              <div className="mt-4">
                <Link href={`/viewer/${encodeURIComponent(d.id)}`} className="inline-block w-full text-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition">
                  Open Viewer
                </Link>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-12 text-center text-sm text-gray-500">
          <Link href="/performance" className="text-indigo-600 hover:underline">View Performance Benchmarks</Link>
        </div>
      </div>
    </div>
  )
}
