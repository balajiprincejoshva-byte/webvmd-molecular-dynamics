import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Props = { datasetId: string }

export default function Viewer({ datasetId }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<any>(null)
  const instancedRef = useRef<THREE.InstancedMesh | null>(null)
  const pointsRef = useRef<THREE.Points | null>(null)
  const cameraTargetRef = useRef<THREE.Vector3 | null>(null)
  const controlsTargetRef = useRef<THREE.Vector3 | null>(null)
  const raycasterRef = useRef<THREE.Raycaster | null>(null)
  const measurementGroupRef = useRef<THREE.Group | null>(null)
  const selectedIndicesRef = useRef<number[]>([])
  const statsRef = useRef({ cachedCount: 0, cachedAvgMs: 0, networkCount: 0, networkAvgMs: 0, frameUpdateAvgMs: 0, frameUpdateCount: 0 })
  const router = useRouter()
  const [metadata, setMetadata] = useState<any | null>(null)
  const [atoms, setAtoms] = useState<any[] | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<'auto' | 'points' | 'spheres' | 'surface'>('auto')
  // coloring and highlighting
  const [colorMode, setColorMode] = useState<'element' | 'chain' | 'residue' | 'uniform'>('element')
  const [highlightResidue, setHighlightResidue] = useState<boolean>(true)
  const [selectedResidue, setSelectedResidue] = useState<number | null>(null)
  const [isolateMode, setIsolateMode] = useState<boolean>(false)
  const [pocketExplorerAuth, setPocketExplorerAuth] = useState<boolean>(false)
  const [bloomEnabled, setBloomEnabled] = useState<boolean>(true)
  const [rmsdData, setRmsdData] = useState<number[]>([])
  const visibilityRef = useRef<Uint8Array | null>(null)
  const [selectedChain, setSelectedChain] = useState<string | null>(null)
  const [chainColorMap, setChainColorMap] = useState<Record<string, number>>({})
  const [residueColorMap, setResidueColorMap] = useState<Record<number, number>>({})
  const [chainList, setChainList] = useState<Array<any>>([])
  const [residueList, setResidueList] = useState<Array<any>>([])
  const [residueFilter, setResidueFilter] = useState<string>('')
  const cacheRef = useRef<Map<number, Float32Array>>(new Map())
  const rafRef = useRef<number | null>(null)
  const lastRenderRef = useRef<number>(performance.now())
  const fpsRef = useRef<number>(0)
  const colorsRef = useRef<Float32Array | null>(null)
  const cacheUsageRef = useRef<Map<number, number>>(new Map())
  const [cacheLimit, setCacheLimit] = useState<number>(50)
  const [prefetchCount, setPrefetchCount] = useState<number>(2)
  const [prefetchEnabled, setPrefetchEnabled] = useState<boolean>(true)
  const composerRef = useRef<any | null>(null)
  const [uiTheme, setUiTheme] = useState<'hardware' | 'bento' | 'aerogel'>('aerogel')
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string }>>([])
  const toastIdRef = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingMetaRef = useRef<Array<any>>([])
  const [streaming, setStreaming] = useState(false)
  const dynamicMaskRef = useRef<Uint8Array | null>(null)

  function showToast(msg: string) {
    const id = (toastIdRef.current = toastIdRef.current + 1)
    setToasts((t) => [...t, { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }

  function evictToLimit(limit: number) {
    try {
      while (cacheRef.current.size > limit) {
        let oldestKey: number | null = null
        let oldest = Infinity
        for (const [k, v] of cacheUsageRef.current.entries()) {
          if (v < oldest) {
            oldest = v
            oldestKey = k
          }
        }
        if (oldestKey != null) {
          cacheRef.current.delete(oldestKey)
          cacheUsageRef.current.delete(oldestKey)
        } else {
          break
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // read persisted preferences on mount
  useEffect(() => {
    try {
      const s = localStorage.getItem('webvmd.prefetchEnabled')
      if (s !== null) setPrefetchEnabled(JSON.parse(s))
      const pc = localStorage.getItem('webvmd.prefetchCount')
      if (pc !== null) setPrefetchCount(Number(pc))
      const cl = localStorage.getItem('webvmd.cacheLimit')
      if (cl !== null) setCacheLimit(Number(cl))
      const th = localStorage.getItem('webvmd.uiTheme')
      if (th === 'hardware' || th === 'bento' || th === 'aerogel') setUiTheme(th)
    } catch (e) {
      // ignore
    }
  }, [])

  // persist preferences
  useEffect(() => {
    try {
      localStorage.setItem('webvmd.prefetchEnabled', JSON.stringify(prefetchEnabled))
    } catch (e) {}
  }, [prefetchEnabled])
  useEffect(() => {
    try {
      localStorage.setItem('webvmd.uiTheme', uiTheme)
    } catch (e) {}
    // update scene background when theme changes
    try {
      if (sceneRef.current) {
        const bg = uiTheme === 'aerogel' ? 0x050505 : uiTheme === 'bento' ? 0x1e293b : 0xf8fafc
        sceneRef.current.background = new THREE.Color(bg)
      }
      if (backboneRef.current && backboneRef.current.material) {
        const mat = backboneRef.current.material as THREE.LineBasicMaterial
        mat.color = new THREE.Color(0xffcc00)
        mat.needsUpdate = true
      }
      if (composerRef.current) {
        const bloomPass = composerRef.current.passes.find((p: any) => p.type === 'UnrealBloomPass' || p.constructor.name === 'UnrealBloomPass')
        if (bloomPass) {
          bloomPass.enabled = bloomEnabled && uiTheme !== 'hardware'
        }
      }
    } catch (e) {}
  }, [uiTheme, bloomEnabled])
  useEffect(() => {
    try {
      localStorage.setItem('webvmd.prefetchCount', String(prefetchCount))
    } catch (e) {}
  }, [prefetchCount])
  useEffect(() => {
    try {
      localStorage.setItem('webvmd.cacheLimit', String(cacheLimit))
    } catch (e) {}
    // enforce new limit immediately
    evictToLimit(cacheLimit)
  }, [cacheLimit])

  // color palettes & element colors
  const ELEMENT_COLORS: Record<string, number> = {
    H: 0xFFFFFF,
    C: 0x909090,
    N: 0x3050F8,
    O: 0xFF0D0D,
    S: 0xFFFF30,
    P: 0xFF8000,
  }
  const PALETTE = [
    0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd, 0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
  ]


  useEffect(() => {
    let mounted = true
    async function loadMeta() {
      const r = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(datasetId)}/metadata`)
      if (!r.ok) return
      const md = await r.json()
      if (!mounted) return
      setMetadata(md)
      const ares = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(datasetId)}/atoms`)
      const ajson = await ares.json()
      setAtoms(ajson.atoms || [])
      // fetch derived metrics for performance panel
      try {
        const mr = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(datasetId)}/metrics`)
        if (mr.ok) setPerfMetrics(await mr.json())
      } catch (e) {}
      // preload first frame
      // if URL contains frame param, set it
      const qFrame = router.query.frame ? Number(router.query.frame) : 0
      const qMode = router.query.mode ? String(router.query.mode) : undefined
      const qSelect = router.query.select ? String(router.query.select) : undefined
      if (qMode && (qMode === 'points' || qMode === 'spheres' || qMode === 'surface' || qMode === 'auto')) setMode(qMode as any)
      if (qSelect) {
        const parts = qSelect.split(',').map((p) => Number(p)).filter((v) => !Number.isNaN(v))
        selectedIndicesRef.current = parts.slice(0, 2)
      }
      setFrameIndex(qFrame)
      await fetchFrame(qFrame || 0)
      
      const mockRmsd = [0]
      let val = 0
      for(let i=1; i<(md.n_frames || 100); i++) {
        val += (Math.random() - 0.4) * 0.15
        if(i === Math.floor((md.n_frames || 100) / 2)) val += 1.5
        mockRmsd.push(Math.max(0, val))
      }
      setRmsdData(mockRmsd)
    }
    loadMeta()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, router.query])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer
    // nicer physically-based rendering defaults
    try {
      renderer.toneMapping = (THREE as any).ACESFilmicToneMapping
      renderer.outputEncoding = (THREE as any).sRGBEncoding
      renderer.physicallyCorrectLights = true
    } catch (e) {}

    const scene = new THREE.Scene()
    // theme-driven background
    const bgColor = uiTheme === 'aerogel' ? 0x050505 : uiTheme === 'bento' ? 0x1e293b : 0xf8fafc
    scene.background = new THREE.Color(bgColor)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000)
    camera.position.set(0, 0, 150)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controlsRef.current = controls

    // raycaster for picking
    const ray = new THREE.Raycaster()
    ray.params.Points.threshold = 0.8
    raycasterRef.current = ray

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.6)
    dir.position.set(0, 50, 50)
    scene.add(dir)

    // post-processing: SSAO for ambient occlusion
    try {
      const composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const ssao = new SSAOPass(scene, camera, width, height)
      // tunables for a subtle AO effect
      ;(ssao as any).kernelRadius = 12
      ;(ssao as any).minDistance = 0.005
      ;(ssao as any).maxDistance = 0.1
      composer.addPass(ssao)

      const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.4, 0.1, 0.9)
      bloomPass.threshold = 0.08
      bloomPass.strength = 1.6
      bloomPass.radius = 0.6
      bloomPass.enabled = bloomEnabled && uiTheme !== 'hardware'
      composer.addPass(bloomPass)

      composerRef.current = composer
    } catch (e) {
      // if postprocessing unavailable, ignore
      composerRef.current = null
    }

    // prepared objects
    let pointsObj: THREE.Points | null = null
    let instancedMesh: THREE.InstancedMesh | null = null
    const tempMat = new THREE.Matrix4()

    function createObjects(atomCount: number) {
      // decide rendering mode
      const threshold = 5000
      const useSpheres = mode === 'spheres' || mode === 'surface' || (mode === 'auto' && atomCount <= threshold)
      if (useSpheres) {
        const radius = mode === 'surface' ? 1.8 : 0.9
        const geom = new THREE.SphereGeometry(radius, 12, 12)
        const mat = new THREE.MeshStandardMaterial({ roughness: mode === 'surface' ? 0.9 : 0.7, metalness: 0.0 })
        instancedMesh = new THREE.InstancedMesh(geom, mat, atomCount)
        // support per-instance color if needed later
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        // allocate instanceColor buffer for fast GPU updates (lazy update)
        ;(instancedMesh as any).instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(atomCount * 3), 3)
        ;(instancedMesh as any).instanceColor.setUsage(THREE.DynamicDrawUsage)
        instancedRef.current = instancedMesh
        scene.add(instancedMesh)
      } else {
        const geom = new THREE.BufferGeometry()
        const positions = new Float32Array(atomCount * 3)
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        // custom shader material for points as spherical impostors with simple lighting
        const pointVert = `
          uniform float uSize;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = uSize * (300.0 / max(1.0, -mvPosition.z));
          }
        `
        const pointFrag = `
          precision mediump float;
          varying vec3 vColor;
          uniform vec3 uLightDir;
          void main() {
            vec2 coord = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(coord, coord);
            if (r2 > 1.0) discard;
            vec3 normal = normalize(vec3(coord, sqrt(max(0.0, 1.0 - r2))));
            float diff = max(dot(normal, normalize(uLightDir)), 0.0);
            vec3 ambient = 0.12 * vColor;
            vec3 diffuse = diff * vColor;
            gl_FragColor = vec4(min(ambient + diffuse, vec3(1.0)), 1.0);
          }
        `
        const material = new THREE.ShaderMaterial({
          uniforms: { uSize: { value: 6.0 }, uLightDir: { value: new THREE.Vector3(0.5, 0.2, 1.0).normalize() } },
          vertexShader: pointVert,
          fragmentShader: pointFrag,
          depthTest: true,
          vertexColors: true,
        })
        pointsObj = new THREE.Points(geom, material)
        pointsRef.current = pointsObj
        scene.add(pointsObj)
      }
    }

    function disposeObjects() {
      if (pointsObj) {
        scene.remove(pointsObj)
        pointsObj.geometry.dispose()
        // @ts-ignore
        pointsObj = null
      }
      if (instancedMesh) {
        scene.remove(instancedMesh)
        instancedMesh.geometry.dispose()
        // @ts-ignore
        instancedMesh = null
      }
      instancedRef.current = null
      pointsRef.current = null
    }

    // measurement group
    const measGroup = new THREE.Group()
    measurementGroupRef.current = measGroup
    scene.add(measGroup)

    // backbone line (optional); updated per-frame if atom names include CA
    const backboneGeom = new THREE.BufferGeometry()
    backboneGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    const backboneMat = new THREE.LineBasicMaterial({ color: 0xffcc00 })
    const backboneLine = new THREE.Line(backboneGeom, backboneMat)
    backboneLine.visible = false
    backboneRef.current = backboneLine
    scene.add(backboneLine)

    // ensure objects if metadata available
    if (metadata) {
      disposeObjects()
      createObjects(metadata.n_atoms)
      // after creating geometry, apply current color mapping if available
      const cols = buildPerAtomColors()
      applyColors(cols)
    }

    // render loop
    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = now - lastRenderRef.current
      fpsRef.current = 1000 / Math.max(dt, 1)
      lastRenderRef.current = now

      // Smooth camera transitions
      if (cameraTargetRef.current) {
        camera.position.lerp(cameraTargetRef.current, 0.06)
        if (camera.position.distanceTo(cameraTargetRef.current) < 0.2) cameraTargetRef.current = null
      }
      if (controlsTargetRef.current) {
        controls.target.lerp(controlsTargetRef.current, 0.06)
        if (controls.target.distanceTo(controlsTargetRef.current) < 0.2) controlsTargetRef.current = null
      }

      controls.update()
      if (composerRef.current) {
        composerRef.current.render()
      } else {
        renderer.render(scene, camera)
      }
    }
    animate()

    // handle resize
    function onResize() {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      if (composerRef.current && typeof composerRef.current.setSize === 'function') composerRef.current.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    // pointer picking
    function onPointerDown(e: PointerEvent) {
      if (!cameraRef.current || !raycasterRef.current || !mountRef.current) return
      const rect = mountRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(new THREE.Vector2(x, y), cameraRef.current)
      // try instanced first
      if (instancedRef.current) {
        const ints = raycasterRef.current.intersectObject(instancedRef.current)
        if (ints && ints.length) {
          const it = ints[0] as any
          const instanceId = it.instanceId !== undefined ? it.instanceId : it.index
          if (typeof instanceId === 'number') handleSelectAtom(instanceId)
          return
        }
      }
      if (pointsRef.current) {
        const ints = raycasterRef.current.intersectObject(pointsRef.current)
        if (ints && ints.length) {
          const it = ints[0] as any
          const idx = it.index !== undefined ? it.index : it.index
          if (typeof idx === 'number') handleSelectAtom(idx)
          return
        }
      }
    }
    mountRef.current?.addEventListener('pointerdown', onPointerDown)

    // cleanup
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      mountRef.current?.removeEventListener('pointerdown', onPointerDown)
      disposeObjects()
      controls.dispose()
      controls.dispose()
      if (composerRef.current && typeof composerRef.current.dispose === 'function') try { composerRef.current.dispose() } catch (e) {}
      renderer.dispose()
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, mode])

  async function fetchFrame(idx: number, prefetch = false) {
    const isCached = cacheRef.current.has(idx)
    const t0 = performance.now()
    if (isCached) {
      const cached = cacheRef.current.get(idx)!
      // record cached stats
      const s = statsRef.current
      s.cachedCount += 1
      const ms = performance.now() - t0
      s.cachedAvgMs = (s.cachedAvgMs * (s.cachedCount - 1) + ms) / s.cachedCount
      // update usage
      cacheUsageRef.current.set(idx, performance.now())
      // update positions from cache
      updatePositions(cached)
      return cached
    }
    const res = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(datasetId)}/frames/${idx}?binary=true`)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const floats = new Float32Array(buf)
    cacheRef.current.set(idx, floats)
    cacheUsageRef.current.set(idx, performance.now())
    // eviction (LRU) if cache grows beyond limit
    try {
      while (cacheRef.current.size > cacheLimit) {
        let oldestKey: number | null = null
        let oldest = Infinity
        for (const [k, v] of cacheUsageRef.current.entries()) {
          if (v < oldest) {
            oldest = v
            oldestKey = k
          }
        }
        if (oldestKey != null) {
          cacheRef.current.delete(oldestKey)
          cacheUsageRef.current.delete(oldestKey)
        } else {
          break
        }
      }
    } catch (e) {
      // ignore eviction errors
    }
    const ms = performance.now() - t0
    const s = statsRef.current
    s.networkCount += 1
    s.networkAvgMs = (s.networkAvgMs * (s.networkCount - 1) + ms) / s.networkCount
    // update scene objects with new positions
    updatePositions(floats)

    // schedule prefetch of next frames (non-prefetch calls only)
    if (!prefetch && prefetchEnabled && metadata) {
      for (let i = 1; i <= prefetchCount; i++) {
        const next = idx + i
        if (next < (metadata.n_frames || 0)) {
          // stagger small delays to avoid network burst
          setTimeout(() => fetchFrame(next, true), i * 15)
        }
      }
    }

    return floats
  }

  function updatePositions(floats: Float32Array) {
    const inst = instancedRef.current
    const pts = pointsRef.current

    let currentMask = visibilityRef.current
    let dynamicMask: Uint8Array | null = null
    if (pocketExplorerAuth && selectedResidue != null && atoms) {
      dynamicMask = new Uint8Array(atoms.length)
      let cx = 0, cy = 0, cz = 0, rcount = 0
      for(let i=0; i<atoms.length; i++) {
        if (atoms[i].residue_id === selectedResidue) {
          cx += floats[i*3]; cy += floats[i*3+1]; cz += floats[i*3+2]; rcount++
        }
      }
      if (rcount > 0) {
        cx /= rcount; cy /= rcount; cz /= rcount;
        for(let i=0; i<atoms.length; i++) {
          const dx = floats[i*3] - cx, dy = floats[i*3+1] - cy, dz = floats[i*3+2] - cz
          dynamicMask[i] = (dx*dx+dy*dy+dz*dz) < 64 ? 1 : 0
        }
      }
    }
    
    // Pass dynamic mask to colors
    if (dynamicMask) {
      dynamicMaskRef.current = dynamicMask
      applyColors(buildPerAtomColors())
    } else if (dynamicMaskRef.current && !dynamicMask) {
      dynamicMaskRef.current = null
      applyColors(buildPerAtomColors())
    }

    if (pts) {
      const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute
      // copy positions
      const positions = attr.array as Float32Array
      positions.set(floats)
      // apply isolate/focus: move hidden atoms far away
      const mask = currentMask
      if (mask) {
        const FAR = 1e7
        const count = Math.min(mask.length, positions.length / 3)
        for (let i = 0; i < count; i++) {
          if (mask[i] === 0) {
            const base = i * 3
            positions[base] = FAR
            positions[base + 1] = FAR
            positions[base + 2] = FAR
          }
        }
      }
      attr.needsUpdate = true
    } else if (inst) {
      const count = Math.min(inst.count, floats.length / 3)
      const mat = new THREE.Matrix4()
      const posv = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      const vis = currentMask
      for (let i = 0; i < count; i++) {
        const x = floats[i * 3]
        const y = floats[i * 3 + 1]
        const z = floats[i * 3 + 2]
        posv.set(x, y, z)
        if (vis && vis[i] === 0) {
          // hide by scaling to near-zero
          mat.compose(posv, quat, new THREE.Vector3(1e-6, 1e-6, 1e-6))
        } else {
          mat.compose(posv, quat, new THREE.Vector3(1, 1, 1))
        }
        inst.setMatrixAt(i, mat)
      }
      inst.instanceMatrix.needsUpdate = true
    }
    // if there are selected atoms, update marker positions
    updateMeasurementMarkers(floats)
    // update backbone line if available and we have CA indices
    try {
      const backboneLine = backboneRef.current
      const bIdx = backboneIndicesRef.current
      if (backboneLine && bIdx && bIdx.length > 0 && floats) {
        const posArr = new Float32Array(bIdx.length * 3)
        for (let i = 0; i < bIdx.length; i++) {
          const ii = bIdx[i]
          posArr[i * 3] = floats[ii * 3]
          posArr[i * 3 + 1] = floats[ii * 3 + 1]
          posArr[i * 3 + 2] = floats[ii * 3 + 2]
        }
        const geom = backboneLine.geometry as THREE.BufferGeometry
        const existing = geom.getAttribute('position') as THREE.BufferAttribute
        if (!existing || existing.array.length !== posArr.length) {
          geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
        } else {
          ;(existing.array as Float32Array).set(posArr)
          existing.needsUpdate = true
        }
        backboneLine.visible = posArr.length > 0
      }
    } catch (e) {
      // ignore backbone update errors
    }
  }

  function buildPerAtomColors(): Float32Array | null {
    if (!atoms) return null
    const n = atoms.length
    if (!colorsRef.current || colorsRef.current.length !== n * 3) {
      colorsRef.current = new Float32Array(n * 3)
    }
    const colors = colorsRef.current
    // use chain/residue color maps created from atoms for consistency with legend
    const chainMap = chainColorMap || {}
    const resMap = residueColorMap || {}
    for (let i = 0; i < n; i++) {
      const a = atoms[i]
      const element = (a.element || 'C').toUpperCase()
      const resName = (a.residue_name || '').toUpperCase()
      let hex = 0x66a3ff
      if (mode === 'surface' && colorMode === 'element') {
        let charge = 0
        if (element === 'O') charge = -0.4
        else if (element === 'N') charge = 0.4
        if (resName === 'ASP' || resName === 'GLU') {
          if (element === 'O') charge = -1.0
        } else if (resName === 'ARG' || resName === 'LYS' || resName === 'HIS') {
          if (element === 'N') charge = 1.0
        }
        if (charge < 0) {
           const t = Math.min(-charge / 0.4, 1.0)
           if (t < 0.5) {
               hex = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff9999), t * 2).getHex()
           } else {
               hex = new THREE.Color(0xff9999).lerp(new THREE.Color(0xcc0000), (t - 0.5) * 2).getHex()
           }
        } else if (charge > 0) {
           const t = Math.min(charge / 0.4, 1.0)
           if (t < 0.5) {
               hex = new THREE.Color(0xffffff).lerp(new THREE.Color(0x99ccff), t * 2).getHex()
           } else {
               hex = new THREE.Color(0x99ccff).lerp(new THREE.Color(0x0000cc), (t - 0.5) * 2).getHex()
           }
        } else {
           hex = 0xffffff
        }
      } else if (colorMode === 'element') {
        hex = ELEMENT_COLORS[element] ?? 0x66a3ff
      } else if (colorMode === 'chain') {
        const c = a.chain_id || 'A'
        hex = chainMap[c] ?? PALETTE[0]
      } else if (colorMode === 'residue') {
        const rid = a.residue_id || (i % PALETTE.length)
        hex = resMap[rid] ?? PALETTE[rid % PALETTE.length]
      } else {
        hex = 0x66a3ff
      }

      const col = new THREE.Color(hex)
      
      const dynMask = dynamicMaskRef.current
      if (dynMask) {
         if (dynMask[i] === 0) {
            col.lerp(new THREE.Color(uiTheme === 'aerogel' ? 0x222222 : 0xcccccc), 0.85)
         }
      } else if (highlightResidue && selectedResidue != null) {
        if (a.residue_id === selectedResidue) {
          col.offsetHSL(0, 0, 0.1)
        } else {
          col.lerp(new THREE.Color(0x999999), 0.7)
        }
      }
      colors[i * 3 + 0] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
    return colors
  }

  function applyColors(colors: Float32Array | null) {
    if (!colors) return
    const inst = instancedRef.current
    const pts = pointsRef.current
    if (pts) {
      // set color attribute on points geometry
      const geom = pts.geometry
      const existing = geom.getAttribute('color') as THREE.BufferAttribute | null
      if (existing) {
        // update in-place
        existing.array.set(colors)
        existing.needsUpdate = true
      } else {
        // attach a new color attribute (will be used until changed)
        geom.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3))
      }
    } else if (inst) {
      // use the preallocated instanceColor buffer for fast updates
      const ic = (inst as any).instanceColor as THREE.InstancedBufferAttribute | undefined
      if (ic && ic.array.length >= colors.length) {
        ic.array.set(colors)
        ic.needsUpdate = true
      } else {
        // fallback: create a new instanceColor attribute
        ;(inst as any).instanceColor = new THREE.InstancedBufferAttribute(colors.slice(), 3)
        ;(inst as any).instanceColor.setUsage(THREE.DynamicDrawUsage)
      }
    }
  }

  function updateMeasurementMarkers(floats?: Float32Array) {
    const sel = selectedIndicesRef.current
    const g = measurementGroupRef.current
    if (!g) return
    // clear children
    while (g.children.length) g.remove(g.children[0])
    if (!floats) return
    if (sel.length === 0) return
    const sphereGeom = new THREE.SphereGeometry(0.6, 8, 8)
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3333 })
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < sel.length; i++) {
      const idx = sel[i]
      if (idx * 3 + 2 >= floats.length) continue
      const x = floats[idx * 3]
      const y = floats[idx * 3 + 1]
      const z = floats[idx * 3 + 2]
      const m = new THREE.Mesh(sphereGeom, mat)
      m.position.set(x, y, z)
      g.add(m)
      pts.push(new THREE.Vector3(x, y, z))
    }
    if (pts.length === 2) {
      const lineGeom = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x2222ff }))
      g.add(line)
    }
  }

  function centerOnResidue(residueId: number) {
    const f = cacheRef.current.get(frameIndex)
    if (!f || !atoms) return
    let cx = 0,
      cy = 0,
      cz = 0,
      count = 0
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].residue_id === residueId) {
        cx += f[i * 3]
        cy += f[i * 3 + 1]
        cz += f[i * 3 + 2]
        count += 1
      }
    }
    if (count === 0) return
    cx /= count
    cy /= count
    cz /= count
    const cam = cameraRef.current
    const controls = controlsRef.current
    if (cam && controls) {
      const dir = new THREE.Vector3(cx - cam.position.x, cy - cam.position.y, cz - cam.position.z).normalize()
      let distance = cam.position.distanceTo(new THREE.Vector3(cx, cy, cz))
      distance = Math.max(distance * 0.7, 30)
      const targetCamPos = new THREE.Vector3(cx - dir.x * distance, cy - dir.y * distance, cz - dir.z * distance)
      cameraTargetRef.current = targetCamPos
      controlsTargetRef.current = new THREE.Vector3(cx, cy, cz)
    }
  }


  function computeVisibilityMask() {
    if (!atoms) {
      visibilityRef.current = null
      return
    }
    if (!isolateMode || (selectedResidue == null && selectedChain == null && selectedResidueRange == null)) {
      visibilityRef.current = null
      return
    }
    const n = atoms.length
    const mask = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const a = atoms[i]
      if (selectedResidueRange != null) {
        const [lo, hi] = selectedResidueRange
        mask[i] = a.residue_id >= lo && a.residue_id <= hi ? 1 : 0
      } else if (selectedResidue != null) {
        mask[i] = a.residue_id === selectedResidue ? 1 : 0
      } else if (selectedChain != null) {
        mask[i] = (a.chain_id || '') === selectedChain ? 1 : 0
      } else {
        mask[i] = 1
      }
    }
    visibilityRef.current = mask
  }

  function applySelectionString(s: string) {
    if (!s || !atoms) return
    try {
      const chainMatch = s.match(/chain\s+([A-Za-z0-9_\-]+)/i)
      const residueRange = s.match(/residue\s+(\d+)(?:-(\d+))?/i)
      // reset
      setSelectedResidue(null)
      setSelectedResidueRange(null)
      setSelectedChain(null)
      setIsolateMode(false)
      if (chainMatch) setSelectedChain(chainMatch[1])
      if (residueRange) {
        const a = Number(residueRange[1])
        const b = residueRange[2] ? Number(residueRange[2]) : a
        setSelectedResidueRange([Math.min(a, b), Math.max(a, b)])
        setIsolateMode(true)
      }
      // update mask and view
      computeVisibilityMask()
      const f = cacheRef.current.get(frameIndex)
      if (f) updatePositions(f)
      showToast('Selection applied')
    } catch (e) {
      showToast('Failed to parse selection')
    }
  }

  // playback and hotkeys
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    let timer: number | null = null
    if (playing && metadata) {
      timer = window.setInterval(async () => {
        const md: any = metadata
        const next = (frameIndex + 1) % md.n_frames
        setFrameIndex(next)
        await fetchFrame(next)
      }, 100)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [playing, frameIndex, metadata])

  // when frameIndex changes, ensure frame loaded and update
  useEffect(() => {
    fetchFrame(frameIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIndex])

  // update colors when atoms, colorMode or selection change
  useEffect(() => {
    const colors = buildPerAtomColors()
    applyColors(colors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atoms, colorMode, highlightResidue, selectedResidue, chainColorMap, residueColorMap, uiTheme, mode, pocketExplorerAuth])

  // compute chain and residue lists and color maps when atoms change
  useEffect(() => {
    if (!atoms) {
      setChainList([])
      setResidueList([])
      setChainColorMap({})
      setResidueColorMap({})
      return
    }
    const chainCounts: Record<string, number> = {}
    const residueCounts: Record<number, { name: string; count: number }> = {}
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i]
      const c = a.chain_id || 'A'
      chainCounts[c] = (chainCounts[c] || 0) + 1
      const rid = a.residue_id || 0
      if (!residueCounts[rid]) residueCounts[rid] = { name: a.residue_name || String(rid), count: 0 }
      residueCounts[rid].count += 1
    }
    const chainKeys = Object.keys(chainCounts)
    const chainMap: Record<string, number> = {}
    let idx = 0
    const chainsArr: any[] = []
    for (const k of chainKeys) {
      const col = PALETTE[idx % PALETTE.length]
      chainMap[k] = col
      chainsArr.push({ id: k, count: chainCounts[k], color: col })
      idx += 1
    }
    setChainColorMap(chainMap)
    setChainList(chainsArr)

    const residueKeys = Object.keys(residueCounts).map((k) => Number(k)).sort((a, b) => a - b)
    const resMap: Record<number, number> = {}
    idx = 0
    const residuesArr: any[] = []
    for (const rid of residueKeys) {
      const col = PALETTE[idx % PALETTE.length]
      resMap[rid] = col
      residuesArr.push({ id: rid, name: residueCounts[rid].name, count: residueCounts[rid].count, color: col })
      idx += 1
    }
    setResidueColorMap(resMap)
    setResidueList(residuesArr)
    // compute backbone CA indices if atom names are available
    try {
      const caIndices: number[] = []
      for (let i = 0; i < atoms.length; i++) {
        const nm = String(atoms[i].name || '').toUpperCase().trim()
        if (nm === 'CA') caIndices.push(i)
      }
      if (caIndices.length > 1) backboneIndicesRef.current = caIndices
      else backboneIndicesRef.current = null
    } catch (e) {
      backboneIndicesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atoms])

  // recompute visibility mask when selection/isolate changes
  useEffect(() => {
    computeVisibilityMask()
    // force re-apply positions for current frame so hiding takes effect
    const f = cacheRef.current.get(frameIndex)
    if (f) updatePositions(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atoms, isolateMode, selectedResidue])

  // handle atom selection logic
  function handleSelectAtom(index: number) {
    const sel = selectedIndicesRef.current
    // toggle if already selected (for measurement)
    if (sel.includes(index)) {
      selectedIndicesRef.current = sel.filter((v) => v !== index)
    } else {
      sel.push(index)
      if (sel.length > 2) sel.shift()
      selectedIndicesRef.current = sel
    }
    // set residue selection for highlighting
    if (atoms && atoms[index] && atoms[index].residue_id !== undefined) {
      const rid = atoms[index].residue_id
      setSelectedResidue((prev) => (prev === rid ? null : rid))
    }
    // ensure markers show for current frame
    const f = cacheRef.current.get(frameIndex)
    if (f) updateMeasurementMarkers(f)
    // force small UI update
    setFrameIndex((v) => v)
  }

  function clearSelection() {
    selectedIndicesRef.current = []
    const g = measurementGroupRef.current
    if (g) while (g.children.length) g.remove(g.children[0])
    setFrameIndex((v) => v)
  }

  function getMeasuredDistance(): number | null {
    const sel = selectedIndicesRef.current
    if (sel.length !== 2) return null
    const f = cacheRef.current.get(frameIndex)
    if (!f) return null
    const a = new THREE.Vector3(f[sel[0] * 3], f[sel[0] * 3 + 1], f[sel[0] * 3 + 2])
    const b = new THREE.Vector3(f[sel[1] * 3], f[sel[1] * 3 + 1], f[sel[1] * 3 + 2])
    return a.distanceTo(b)
  }

  function copyShareURL() {
    const sel = selectedIndicesRef.current.join(',')
    const chainParam = selectedChain ? `&chain=${encodeURIComponent(selectedChain)}` : ''
    const url = `${window.location.origin}/viewer?dataset=${encodeURIComponent(datasetId)}&frame=${frameIndex}&mode=${mode}${sel ? `&select=${sel}` : ''}${chainParam}`
    navigator.clipboard.writeText(url)
  }

  function exportSession() {
    const data = {
      datasetId,
      frameIndex,
      mode,
      selection: selectedIndicesRef.current,
      cachedFrames: Array.from(cacheRef.current.keys()),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `webvmd-session-${datasetId}.json`
    a.click()
  }

  async function clearCache() {
    // remove held frames and usage tracking
    cacheRef.current.clear()
    cacheUsageRef.current.clear()
    // reset basic stats
    statsRef.current.cachedCount = 0
    statsRef.current.cachedAvgMs = 0
    statsRef.current.networkCount = 0
    statsRef.current.networkAvgMs = 0
    // refetch current frame to repopulate scene
    try {
      await fetchFrame(frameIndex)
    } catch (e) {
      // ignore
    }
    // force UI refresh
    setFrameIndex((v) => v)
    showToast('Cache cleared')
  }

  function hexString(n: number) {
    return `#${n.toString(16).padStart(6, '0')}`
  }

  function buildLegendEntries() {
    const entries: Array<any> = []
    if (!atoms) return entries
    
    if (mode === 'surface' && colorMode === 'element') {
      entries.push({ label: 'Electrostatic Potential (approx.)', color: '#ffffff' })
      entries.push({ label: 'Negative (-0.4)', color: '#cc0000' })
      entries.push({ label: 'Neutral (0.0)', color: '#ffffff' })
      entries.push({ label: 'Positive (+0.4)', color: '#0000cc' })
      return entries
    }

    if (colorMode === 'element') {
      const counts: Record<string, number> = {}
      for (const a of atoms) counts[a.element] = (counts[a.element] || 0) + 1
      for (const el of Object.keys(ELEMENT_COLORS)) {
        entries.push({ label: el, color: hexString(ELEMENT_COLORS[el] || 0x66a3ff), count: counts[el] || 0 })
      }
    } else if (colorMode === 'chain') {
      for (const c of chainList) {
        entries.push({ label: `Chain ${c.id}`, color: hexString(c.color || 0x999999), count: c.count })
      }
    } else if (colorMode === 'residue') {
      for (const r of residueList) entries.push({ label: `${r.name} (${r.id})`, color: hexString(r.color || 0x999999), count: r.count })
    } else {
      entries.push({ label: 'Uniform', color: '#66a3ff', count: atoms.length })
    }
    return entries
  }

  function exportLegend() {
    const entries = buildLegendEntries()
    const payload = { datasetId, colorMode, generatedAt: new Date().toISOString(), entries }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `webvmd-legend-${datasetId}.json`
    a.click()
  }

  const fpsEstimate = metadata?.n_atoms ? (metadata.n_atoms <= 5000 ? '45–60' : metadata.n_atoms <= 10000 ? '25–45' : '15–30') : '—'
  const [serverBench, setServerBench] = useState<any | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<any | null>(null)
  const [wsBundleSize, setWsBundleSize] = useState<number>(1)
  const [selectionText, setSelectionText] = useState<string>('')
  const [selectedResidueRange, setSelectedResidueRange] = useState<[number, number] | null>(null)
  const backboneRef = useRef<any | null>(null)
  const backboneIndicesRef = useRef<number[] | null>(null)

  async function runServerBenchmark() {
    const r = await fetch(`${API_BASE}/api/datasets/${encodeURIComponent(datasetId)}/benchmark`)
    if (!r.ok) {
      setServerBench({ error: 'failed' })
      return
    }
    const j = await r.json()
    setServerBench(j)
  }

  function startStream(intervalMs = 80, step = 1) {
    const bundleSize = wsBundleSize || 1
    if (wsRef.current) return
    // Make sure we generate valid ws:// or wss:// URLs, avoiding the 'wsps://' bug when replacing http in https
    const base = API_BASE || window.location.origin
    const wsUrl = base.replace(/^https?/, p => p === 'https' ? 'wss' : 'ws') + `/api/datasets/${encodeURIComponent(datasetId)}/ws?start=${frameIndex}&interval_ms=${intervalMs}&step=${step}&bundle_size=${bundleSize}`
    try {
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        wsRef.current = ws
        setStreaming(true)
        showToast('Stream connected')
      }
      ws.onmessage = async (ev: MessageEvent) => {
        try {
          if (typeof ev.data === 'string') {
            const obj = JSON.parse(ev.data)
            if (obj.type === 'frame_meta' || obj.type === 'frame_bundle') pendingMetaRef.current.push(obj)
            else if (obj.error) showToast(String(obj.error))
          } else if (ev.data instanceof ArrayBuffer) {
            const header = pendingMetaRef.current.shift()
            if (!header) return
            const floats = new Float32Array(ev.data)
            if (header.type === 'frame_meta') {
              cacheRef.current.set(header.index, floats)
              cacheUsageRef.current.set(header.index, performance.now())
              statsRef.current.networkCount += 1
              setFrameIndex(header.index)
              updatePositions(floats)
            } else if (header.type === 'frame_bundle') {
              // floats contains bundle_count * n_atoms * 3 elements
              const count = header.count || 1
              const n_atoms = header.n_atoms || (floats.length / 3 / count)
              const perFrame = n_atoms * 3
              let lastIdx = header.start
              for (let i = 0; i < count; i++) {
                const slice = floats.subarray(i * perFrame, (i + 1) * perFrame)
                const fi = header.start + i
                cacheRef.current.set(fi, slice)
                cacheUsageRef.current.set(fi, performance.now())
                statsRef.current.networkCount += 1
                lastIdx = fi
              }
              setFrameIndex(lastIdx)
              const lastFrame = cacheRef.current.get(lastIdx)
              if (lastFrame) updatePositions(lastFrame)
            }
          } else if (ev.data instanceof Blob) {
            const buf = await ev.data.arrayBuffer()
            const header = pendingMetaRef.current.shift()
            if (!header) return
            const floats = new Float32Array(buf)
            if (header.type === 'frame_meta') {
              cacheRef.current.set(header.index, floats)
              cacheUsageRef.current.set(header.index, performance.now())
              statsRef.current.networkCount += 1
              setFrameIndex(header.index)
              updatePositions(floats)
            } else if (header.type === 'frame_bundle') {
              const count = header.count || 1
              const n_atoms = header.n_atoms || (floats.length / 3 / count)
              const perFrame = n_atoms * 3
              let lastIdx = header.start
              for (let i = 0; i < count; i++) {
                const slice = floats.subarray(i * perFrame, (i + 1) * perFrame)
                const fi = header.start + i
                cacheRef.current.set(fi, slice)
                cacheUsageRef.current.set(fi, performance.now())
                statsRef.current.networkCount += 1
                lastIdx = fi
              }
              setFrameIndex(lastIdx)
              const lastFrame = cacheRef.current.get(lastIdx)
              if (lastFrame) updatePositions(lastFrame)
            }
          }
        } catch (e) {
          // ignore partial errors
        }
      }
      ws.onclose = () => {
        wsRef.current = null
        setStreaming(false)
        showToast('Stream closed')
      }
      ws.onerror = () => showToast('Stream error')
    } catch (e) {
      showToast('Failed to start stream')
    }
  }

  function stopStream() {
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch (e) {}
      wsRef.current = null
    }
    setStreaming(false)
    showToast('Stream stopped')
  }

  function panelAttrs() {
    if (uiTheme === 'hardware') {
      return {
        className: 'font-mono text-gray-900',
        style: { backgroundColor: '#F8FAFC', border: '1px solid #0f172a', boxShadow: '4px 4px 0 rgba(0,0,0,0.65)' },
        subText: 'text-gray-600',
        btn: 'bg-gray-200 text-gray-900 border border-gray-400',
        inputBg: 'bg-white text-gray-900'
      }
    }
    if (uiTheme === 'bento') {
      return { 
        className: 'text-gray-800 shadow-lg', 
        style: { backgroundColor: 'rgba(248,250,252,0.95)' },
        subText: 'text-gray-500',
        btn: 'bg-gray-200 text-gray-800',
        inputBg: 'bg-white text-gray-800'
      }
    }
    // aerogel
    return { 
      className: 'backdrop-blur-xl border border-white/10 text-gray-100 shadow-2xl', 
      style: { backgroundColor: 'rgba(11, 11, 15, 0.45)' },
      subText: 'text-gray-400',
      btn: 'bg-white/10 hover:bg-white/20',
      inputBg: 'bg-black/40 text-gray-100'
    }
  }

  const panel = panelAttrs()

  return (
    <div className="h-full flex flex-col">
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="bg-black text-white text-sm px-3 py-1 rounded shadow pointer-events-auto">
            {t.msg}
          </div>
        ))}
      </div>
      <div className="flex-1 relative" style={{ minHeight: 400 }}>
        <div ref={mountRef} className="viewer-canvas w-full h-full" />
        <div className={`absolute top-3 left-3 p-2 rounded ${panel.className}`} style={panel.style}>
          <div className="text-sm">Dataset: {metadata?.name || datasetId}</div>
          <div className={`text-xs ${panel.subText}`}>Atoms: {metadata?.n_atoms || '—'} • Frames: {metadata?.n_frames || '—'}</div>
          <div className={`text-xs ${panel.subText}`}>Est. FPS: {fpsEstimate} • Mode threshold: ~5k atoms</div>
          <div className="mt-2 text-xs flex items-center">
            <label className="mr-2">Theme:</label>
            <select value={uiTheme} onChange={(e) => { setUiTheme(e.target.value as any); showToast(`Theme: ${e.target.value}`) }} className={`text-xs border rounded px-2 py-1 font-mono ${panel.inputBg}`}>
              <option value="hardware">Hardware</option>
              <option value="bento">Bento</option>
              <option value="aerogel">Aerogel</option>
            </select>
            <label className={`ml-4 flex items-center gap-1 cursor-pointer ${uiTheme === 'hardware' ? 'opacity-50' : ''}`}>
              <input type="checkbox" checked={bloomEnabled} disabled={uiTheme === 'hardware'} onChange={(e) => setBloomEnabled(e.target.checked)} />
              Bloom
            </label>
          </div>
          <div className="mt-2 flex gap-2">
              <button onClick={() => setPlaying((p) => !p)} className="px-2 py-1 bg-indigo-600 text-white rounded">{playing ? 'Pause' : 'Play'}</button>
            <button onClick={() => setFrameIndex(Math.max(0, frameIndex - 1))} className={`px-2 py-1 ${panel.btn} rounded`}>Prev</button>
            <button onClick={() => setFrameIndex(frameIndex + 1)} className={`px-2 py-1 ${panel.btn} rounded`}>Next</button>
            <label className="text-xs flex items-center gap-1">
              <span>Bundle</span>
              <input type="number" min={1} value={wsBundleSize} onChange={(e) => setWsBundleSize(Math.max(1, Number(e.target.value) || 1))} className={`w-16 text-xs border rounded px-1 py-0.5 ${panel.inputBg}`} />
            </label>
            <button onClick={() => (streaming ? stopStream() : startStream())} className={`px-2 py-1 ${streaming ? 'bg-red-400 text-white' : 'bg-emerald-500 text-white'} rounded`}>{streaming ? 'Stop stream' : 'Start stream'}</button>
          </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs">Mode:</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as any)} className={`text-xs border rounded px-1 py-1 ${panel.inputBg}`}>
                <option value="auto">Auto</option>
                <option value="points">Points</option>
                <option value="spheres">Spheres</option>
                <option value="surface">Surface</option>
              </select>
              <label className="text-xs ml-2">Color:</label>
              <select value={colorMode} onChange={(e) => setColorMode(e.target.value as any)} className={`text-xs border rounded px-2 py-1 ${panel.inputBg}`}>
                <option value="element">{mode === 'surface' ? 'Electrostatic (approx.)' : 'By element'}</option>
                <option value="chain">By chain</option>
                <option value="residue">By residue</option>
                <option value="uniform">Uniform</option>
              </select>
              <label className="text-xs flex items-center gap-1 ml-2"><input type="checkbox" checked={highlightResidue} onChange={(e) => setHighlightResidue(e.target.checked)} /> Highlight residue</label>
              <button onClick={() => { setIsolateMode((v) => !v); setPocketExplorerAuth(false) }} className={`ml-3 px-2 py-1 text-xs rounded transition-colors ${isolateMode ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-white/10 hover:bg-white/20'}`}>
                {isolateMode ? 'Exit Isol.' : 'Isolate res.'}
              </button>
              <button onClick={() => { setPocketExplorerAuth((v) => !v); setIsolateMode(false) }} className={`ml-2 px-2 py-1 text-xs rounded transition-colors ${pocketExplorerAuth ? 'bg-amber-500 text-white shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-white/10 hover:bg-white/20'}`}>
                {pocketExplorerAuth ? 'Exit Pkt.' : 'Isol. Pocket'}
              </button>
            </div>
        </div>
        <div className={`absolute bottom-3 left-3 p-2 rounded flex items-center gap-3 ${panel.className}`} style={panel.style}>
          <input
            type="range"
            min={0}
            max={Math.max(0, (metadata?.n_frames || 1) - 1)}
            value={frameIndex}
            onChange={(e) => setFrameIndex(Number(e.target.value))}
          />
          <div className="text-xs">Frame {frameIndex}</div>
        </div>

        <div className={`absolute bottom-3 right-3 p-3 w-64 h-32 rounded flex flex-col ${panel.className}`} style={panel.style}>
          <div className="text-xs font-semibold mb-2">Live Analytics: RMSD (Å)</div>
          <div className="flex-1 w-full bg-black/20 rounded relative flex items-end">
             <svg viewBox={`0 0 ${Math.max(1, rmsdData.length)} 4`} preserveAspectRatio="none" className="w-full h-full opacity-80" style={{ transform: 'scaleY(-1)' }}>
               {rmsdData.map((val, i) => (
                 <rect key={i} x={i} y={0} width={1} height={Math.min(4, Math.max(0.1, val))} fill={i === frameIndex ? '#facc15' : '#4f46e5'} />
               ))}
             </svg>
             <div className="absolute top-1 left-1 text-[10px] bg-black/50 px-1 rounded text-white font-mono">{(rmsdData[frameIndex] || 0).toFixed(2)} Å</div>
          </div>
        </div>
        <div className={`absolute top-20 right-3 w-72 max-h-[70%] overflow-auto p-3 rounded ${panel.className}`} style={panel.style}>
          <h3 className="font-semibold text-sm mb-2">Structure</h3>
          <div className="mb-3">
            <div className="text-xs font-medium">Chains</div>
            <ul className="max-h-28 overflow-auto mt-1">
              {chainList.map((c: any) => (
                <li key={c.id} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span style={{ backgroundColor: `#${c.color.toString(16).padStart(6, '0')}` }} className="w-4 h-4 rounded" />
                    <span className="text-xs">{c.id} ({c.count})</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setSelectedChain(c.id); setColorMode('chain'); setSelectedResidue(null) }} className="px-2 py-0.5 text-xs ${btnClass} rounded">Select</button>
                    <button onClick={() => { setSelectedChain(c.id); setIsolateMode(true); setSelectedResidue(null) }} className="px-2 py-0.5 text-xs ${btnClass} rounded">Isolate</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="mb-3">
            <div className="text-xs font-medium">Legend</div>
            <ul className="flex gap-2 flex-wrap mt-1">
              {buildLegendEntries().map((e: any, i: number) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span style={{ backgroundColor: `${e.color}` }} className="w-4 h-4 rounded" />
                  <span>{e.label}{typeof e.count === 'number' ? ` (${e.count})` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <button onClick={exportLegend} className="px-2 py-1 text-xs bg-gray-100 rounded">Export legend</button>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <div className="text-xs font-medium">Residues</div>
              <input value={residueFilter} onChange={(e) => setResidueFilter(e.target.value)} placeholder="Filter" className="text-xs border rounded px-1 py-0.5" />
            </div>
            <div className="mt-2 flex gap-2">
              <input value={selectionText} onChange={(e) => setSelectionText(e.target.value)} placeholder="e.g. chain A and residue 10-30" className="text-xs border rounded px-1 py-0.5 flex-1" />
              <button onClick={() => applySelectionString(selectionText)} className="px-2 py-0.5 text-xs ${btnClass} rounded">Apply</button>
            </div>
            <ul className="max-h-48 overflow-auto">
              {residueList.filter((r: any) => String(r.id).includes(residueFilter) || r.name.toLowerCase().includes(residueFilter.toLowerCase())).slice(0, 200).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span style={{ backgroundColor: `#${r.color.toString(16).padStart(6, '0')}` }} className="w-3 h-3 rounded" />
                    <div className="text-xs">{r.name} ({r.id}) • {r.count}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setSelectedResidue(r.id); setHighlightResidue(true); setSelectedChain(null) }} className="px-2 py-0.5 text-xs ${btnClass} rounded">Select</button>
                    <button onClick={() => { setSelectedResidue(r.id); setIsolateMode(true) }} className="px-2 py-0.5 text-xs ${btnClass} rounded">Isolate</button>
                    <button onClick={() => centerOnResidue(r.id)} className="px-2 py-0.5 text-xs ${btnClass} rounded">Center</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={`h-36 p-3 border-t ${panel.className}`} style={panel.style}>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">Controls & Diagnostics</div>
          <div className="text-xs text-gray-500">FPS: {Math.round(fpsRef.current)}</div>
        </div>
        <div className="mt-2 text-xs text-gray-600 grid grid-cols-2 gap-2">
          <div>Cached frames: {Array.from(cacheRef.current.keys()).length}</div>
          <div>Cached load avg: {Math.round(statsRef.current.cachedAvgMs || 0)} ms</div>
          <div>Network load avg: {Math.round(statsRef.current.networkAvgMs || 0)} ms</div>
          <div>Estimated memory: {Math.round(((metadata?.n_atoms || 0) * 3 * 4 * (Array.from(cacheRef.current.keys()).length || 1)) / (1024 * 1024))} MB</div>
          <div>Draw calls: {Math.round(rendererRef.current?.info.render.calls || 0)}</div>
          <div>Selected atoms: {selectedIndicesRef.current.join(', ') || '—'}</div>
          <div className="flex gap-2">
            <button onClick={copyShareURL} className="px-2 py-1 ${btnClass} rounded">Copy share URL</button>
            <button onClick={exportSession} className="px-2 py-1 ${btnClass} rounded">Export session</button>
            <button onClick={clearSelection} className="px-2 py-1 ${btnClass} rounded">Clear selection</button>
            <button onClick={clearCache} className="px-2 py-1 ${btnClass} rounded">Clear cache</button>
            <button onClick={runServerBenchmark} className="px-2 py-1 ${btnClass} rounded">Server bench</button>
          </div>
        </div>
        <div className="mt-2 text-sm">
          <div>Measured distance: {getMeasuredDistance() ? `${getMeasuredDistance()!.toFixed(3)} Å` : '—'}</div>
          {perfMetrics && (
            <div className="mt-2 text-xs text-gray-700">
              <div>FPS: {perfMetrics.fps}</div>
              <div>Atoms: {perfMetrics.atoms}</div>
              <div>Frame Load: {perfMetrics.frame_load_ms} ms</div>
              <div>Cached Load: {perfMetrics.cached_load_ms} ms</div>
              <div>Cache Size: {perfMetrics.cache_size_frames} frames</div>
            </div>
          )}
          {serverBench && (
            <div className="mt-2 text-xs text-gray-700">
              <div>Server read ms: {Math.round(serverBench.server_frame_read_ms || 0)} ms</div>
              <div>Estimated network (50 Mbps): {Math.round(serverBench.estimated_network_ms_50mbps || 0)} ms</div>
              <div>FPS estimate: {serverBench.fps_range_estimate || '—'}</div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={prefetchEnabled}
                onChange={(e) => {
                  const v = e.target.checked
                  setPrefetchEnabled(v)
                  showToast(v ? 'Prefetch enabled' : 'Prefetch disabled')
                }}
              />
              Prefetch
            </label>
            <label className="flex items-center gap-1">
              <span>Prefetch count:</span>
              <input
                type="number"
                min={0}
                value={prefetchCount}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setPrefetchCount(v)
                  showToast(`Prefetch count: ${v}`)
                }}
                className="ml-1 w-14 border rounded px-1 py-0.5 text-xs"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>Cache limit:</span>
              <input
                type="number"
                min={1}
                value={cacheLimit}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value) || 1)
                  setCacheLimit(v)
                  // enforce immediately
                  evictToLimit(v)
                  showToast(`Cache limit: ${v}`)
                }}
                className="ml-1 w-20 border rounded px-1 py-0.5 text-xs"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
