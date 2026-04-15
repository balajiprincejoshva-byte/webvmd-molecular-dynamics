# WebVMD: Molecular Dynamics in the Browser

## 🧬 Project Overview
WebVMD is a highly-optimized, browser-native computational biology platform designed for the interactive visualization of large-scale molecular dynamics (MD) trajectories. Built using a modern, decoupled stack (Next.js/React frontend paired with a high-bandwidth FastAPI Python backend), WebVMD achieves fluid, high frame-rate rendering of complex biological macromolecules natively in the web browser, eliminating the need for heavy desktop simulation software.

## 🎯 Primary Goal
The overarching goal of WebVMD is to serve as a **premium, production-grade portfolio piece** aimed at top-tier biotech and computational biology employers. Rather than simply rendering a static PDB file, WebVMD demonstrates mastery across the entire modern technical stack: from backend byte-streaming to advanced WebGL shader programming, capped off with a visually stunning, cinematic user interface that rivals enterprise scientific software.

---

## ✨ Key Features

### 1. High-Performance WebGL Engine
* **Dynamic Geometry Scaling:** Built heavily upon **Three.js**, the application actively analyzes the scale of the dataset (ex: `AlphaFold3_Predicted_Kinase` vs. massive `SARS_CoV_2_Spike` complexes) and seamlessly scales its rendering pipeline. It utilizes `InstancedMesh` with dynamic matrix updates for moderately sized compounds, and drops down to high-performance GLSL `Points` shaders for massive, hundred-thousand-atom trajectories.
* **Cinematic Post-Processing:** Leverages advanced WebGL compositing, including Screen-Space Ambient Occlusion (SSAO) for deep structural shadows, and an **UnrealBloomPass** to invoke a volumetric, photorealistic glow mimicking modern high-end scientific modeling.

### 2. Binary WebSocket Streaming
* **Real-time Trajectory Playback:** Natively streams complex sequence frames over highly-compressed binary WebSockets using a decoupled Python FastAPI backend.
* **Intelligent Caching:** Implements an LRU pipeline cache and frame-prefetching protocols directly in the frontend, preventing network bottlenecks during playback and enforcing butter-smooth >60 FPS manipulation. 

### 3. "Aerogel" Glassmorphism UX
* Employs a stunning, tailored modern aesthetic using pure responsive Tailwind CSS.
* **Theme Engine:** Automatically toggles interface styles alongside material shader parameters natively switching between a stark `Hardware` workspace, a clean `Bento` layer, and a cinematic `Aerogel` dark-mode glassmorphism interface.

### 4. Domain-Specific Analytics
* **Live Root-Mean-Square Deviation (RMSD):** Integrates an active SVG-based line chart that dynamically tracks and plots the simulated spatial deviation of the trajectory natively reacting to frame progression.
* **8Å Pocket Explorer:** Simulates a modern pharmacological drug-binding workflow. With a click, the spatial distance from the active selected residue to all surrounding atoms is calculated, and everything beyond a functional 8-Angstrom radius is actively hidden from the view matrix. 

### 5. Seamless UX and Interpolation
* Utilizes mathematical camera interpolation (`Vector3.lerp`) inside the raw `requestAnimationFrame` render loop. Instead of jarring spatial jumps when focusing on specific residues, the engine computes a target directional vector and algorithmically glides the camera directly to the structural feature. 
* Offers native space-bar play/pause toggling mimicking professional film/playback utilities.
