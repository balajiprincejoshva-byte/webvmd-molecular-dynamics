import React from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'

const Viewer = dynamic(() => import('../../components/Viewer'), { ssr: false })

export default function ViewerPage() {
  const router = useRouter()
  const { id } = router.query

  if (!id) return <div className="p-6">Loading...</div>

  return (
    <div className="h-screen">
      <Viewer datasetId={String(id)} />
    </div>
  )
}
