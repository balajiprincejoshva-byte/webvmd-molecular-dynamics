LinkedIn Project Blurb — WebVMD

WebVMD — streaming molecular dynamics viewer (FastAPI + Next.js + Three.js)

I built a lightweight, production-minded web viewer for molecular dynamics trajectories that streams binary frames from a Python FastAPI backend to a Next.js + Three.js frontend. It supports background imports (disk-staged), a persistent job queue, and performant rendering strategies (instanced spheres and points/impostors) to handle thousands of atoms interactively.

Why it matters:
- Enables shareable, reproducible MD visualizations without heavy desktop tools.
- Designed for cloud workflows: Dockerized, CI-ready, and prepared for S3/object-store integration.

Key achievements:
- Binary WebSocket streaming and bundle-frame support for low-latency playback.
- Background importer with persistent job store and TTL cleanup for safe large-file uploads.
- Viewer playback, selection language, backbone CA visualization, and a performance diagnostics panel.

Try it locally:
- `docker-compose up --build`
- `http://localhost:3000/viewer?dataset=demo_sample`

If you'd like a live demo or to discuss integrating this with simulation pipelines, message me and I’ll walk you through the architecture and deployment options.
