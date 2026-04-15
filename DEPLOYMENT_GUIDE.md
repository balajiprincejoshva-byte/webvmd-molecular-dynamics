# 🚀 WebVMD Deployment Guide

You asked some great questions regarding how to actually get this on the internet so you can share the link in your LinkedIn post. 

### Should I host frontend and backend separately?
**Yes.** Modern web applications heavily decoupled like this always host the frontend and backend on different native cloud providers. The React frontend should go on an Edge Content Delivery Network (like Vercel), while the Python backend computing the WebSockets should go on an application server (like Render or Railway).

### Should I create separate repos for frontend and backend?
**No!** You should keep them together in exactly the same repository structure you currently have (a **Monorepo**). It is completely standard to keep the `frontend` and `backend` folders side-by-side. Both Vercel and Render allow you to simply "Point" their deployment bots at a specific sub-folder inside your main repository so they know what to build.

### What should I name the repository?
I highly recommend naming the repository exactly **`webvmd-molecular-dynamics`** or **`WebVMD-Explorer`**. It sounds incredibly clinical and authoritative.

---

## Step-by-Step Live Deployment

### Phase 1: Push to GitHub
1. Create a new public repository on GitHub named `webvmd-molecular-dynamics`.
2. Push your current code to the repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: WebVMD Alpha Release"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/webvmd-molecular-dynamics.git
   git push -u origin main
   ```

### Phase 2: Deploy the Backend (Free on Render.com)
1. Go to [Render](https://render.com/) and hook it up to your GitHub.
2. Click **New +** -> **Web Service**.
3. Select your `webvmd-molecular-dynamics` repository.
4. **Important Configuration Requirements:**
   - **Root Directory**: Type in `backend` (this tells Render to ignore the Next.js stuff).
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port 10000`
5. Click **Create Web Service**. Wait a few minutes. Render will generate a live URL for your API (e.g., `https://webvmd-api-123.onrender.com`). *Copy this URL.*

### Phase 3: Deploy the Frontend (Free on Vercel.com)
1. Go to [Vercel](https://vercel.com/) and hook it up to your GitHub.
2. Click **Add New** -> **Project**.
3. Import your `webvmd-molecular-dynamics` repository.
4. **Important Configuration Requirements:**
   - **Root Directory**: Press edit and select the `frontend` folder (this tells Vercel to ignore the Python stuff).
   - **Framework Preset**: Vercel should auto-detect **Next.js**.
   - Expand the **Environment Variables** section and add:
     - Name: `NEXT_PUBLIC_API_URL`
     - Value: pasting the API URL you copied from Render (e.g., `https://webvmd-api-123.onrender.com`).
5. Click **Deploy**.

### Phase 4: Validating CORS
By default, the backend currently has wildcard CORS (`allow_origins=["*"]`) enabled, so the second Vercel creates your frontend Live URL (e.g., `https://webvmd.vercel.app`), your frontend will reach out directly to the Render URL and the WebSockets will connect seamlessly!

Once Vercel gives you that green **"Deployment Complete"** screen, you can copy the Vercel link and paste it directly into your LinkedIn post as a live demo!
