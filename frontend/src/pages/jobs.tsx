import React, { useEffect, useState } from 'react'

type Job = any

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setJobs(d.jobs || [])
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <h1>Background Jobs</h1>
      {loading ? (
        <p>Loading…</p>
      ) : jobs.length === 0 ? (
        <p>No jobs in the queue.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>ID</th>
              <th style={{ textAlign: 'left' }}>Type</th>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Created</th>
              <th style={{ textAlign: 'left' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j: Job) => (
              <tr key={j.id} style={{ borderTop: '1px solid #eee' }}>
                <td>{j.id}</td>
                <td>{j.type}</td>
                <td>{j.status}</td>
                <td>{j.created_at || j.staged_at || ''}</td>
                <td style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                  {JSON.stringify(j, null, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
