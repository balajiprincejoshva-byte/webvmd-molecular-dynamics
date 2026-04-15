import React from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'

const Viewer = dynamic(() => import('../../components/Viewer'), { ssr: false })

export default function ViewerIndex() {
  const router = useRouter()
  const { dataset } = router.query

  if (!dataset) return <div className="p-6">Provide `?dataset=YOUR_DATASET` in the URL</div>

  return (
    <div className="h-screen">
      <Viewer datasetId={String(dataset)} />
    </div>
  )
}
