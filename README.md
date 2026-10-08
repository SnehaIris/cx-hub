# CX Hub v2 — deploy on Render

This is the upgraded CX Hub: a categorized directory of CX tools, forms,
trackers, SOPs and guides, with a landing page (Common Tools / DSA / CC &
borrow / DCA), search, drag-to-reorder, an Activity Center, and a Removed
Links archive — all password-gated for editing.

## What's in this folder
- `server.js` — the backend (serves the page + the API)
- `public/index.html` — the page people see
- `data.json` — the starting set of links, already sorted into categories and doc types (this file updates automatically as people add/remove/reorder links)
- `package.json` — tells Render what to install and how to start the app

## Step 1 — Put this on GitHub
You can either start a brand-new repo, or replace the contents of your
existing `cx-hub` repo with these files (recommended, since Render is
already connected to it).

**To replace your existing repo's files:**
1. Go to your repo on github.com.
2. Delete the old files one at a time (click the file → trash icon → commit), or just upload the new ones with the same names to overwrite them (`server.js`, `package.json`, `data.json`, `public/index.html` will all overwrite cleanly since the names match).
3. Click "Add file" → "Upload files", then drag in `server.js`, `package.json`, `data.json`, and the whole `public` folder (containing the new `index.html`) from this project.
4. Commit the changes.

**To start fresh instead:** follow the same GitHub steps as last time (new empty repo → Upload files → drag in everything from this folder, keeping the `public` folder structure).

## Step 2 — Deploy on Render
If you're reusing your existing Render service, you don't need to redo any
setup — just trigger **Manual Deploy → Deploy latest commit** after your
GitHub commit lands, and it'll pick up the new code automatically.

If you're setting up fresh:
1. Go to [render.com](https://render.com) and sign in.
2. **New +** → **Web Service** → connect your repo.
3. Fill in:
   - **Root Directory**: leave blank (files should be at the top of the repo)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Under **Environment Variables**, add:
   - **Key**: `EDIT_PASSWORD`
   - **Value**: a password of your choice
5. Click **Create Web Service** and wait for it to go live.

## What's new in this version
- **New navigation**: landing page shows Common Tools, DSA, CC & borrow, DCA. Opening DSA/CC & borrow/DCA shows Forms, Trackers & Response Sheets, SOP's, and Doc's & Guides as tabs, with a search bar that searches across all four at once.
- **Drag-to-reorder** (editor mode only): reorder the top-level categories, the doc-type tabs within a category, and the items within a list — just drag the ⠿ handle. Changes save immediately.
- **Add Link**: open the category/doc-type you want, tap **+ Add link**, and it's added right there.
- **Inline open counts**: once edit access is unlocked, every link shows how many times it's been opened, right next to its ✕ delete button.
- **📊 Activity Center**: total page views, total link opens, a 14-day views chart, a full per-link open-count list, and a CSV export of all of it.
- **🗑️ Removed links**: a running archive of everything that's ever been deleted, with name, URL, category, doc type, and removal date.

All of this is gated behind the same `EDIT_PASSWORD` as before — regular
viewers only ever see the read-only hub.

## Important limitations to know about (free tier)
- **Spin-down delay**: Render's free tier sleeps the app after 15 minutes of inactivity. The first visit after a quiet period can take 30–50 seconds to wake up.
- **Data resets on restart, not just redeploy**: `data.json` and `stats.json` live on Render's server and update as people use the app, but Render's free tier wipes local files every time the service restarts — and it restarts automatically whenever it spins down from 15 minutes of inactivity and then wakes back up. In practice this means added/removed links and usage stats can silently revert to whatever's in your GitHub repo, even without you redeploying anything.

  **The fix — add a persistent disk (~$1/month):**
  1. On your Render service page, go to the **Disks** tab (or **Settings** → scroll to Disks, depending on Render's current layout).
  2. Click **Add Disk**. Give it a name (e.g. `cx-hub-data`), a size (1 GB is plenty), and a **Mount Path** of `/data`.
  3. Save — Render will redeploy your service with the disk attached.
  4. Go to **Environment** and add two variables:
     - `DATA_FILE` = `/data/data.json`
     - `STATS_FILE` = `/data/stats.json`
  5. Redeploy once more (Manual Deploy → Deploy latest commit). The app already reads these paths from environment variables, so no code changes are needed.
  6. The very first time this runs, `/data/data.json` won't exist yet, so the app starts empty — re-add your links once through the Add Link button, or upload a `data.json` copy there if Render's disk browser allows it. After that, everything persists properly across restarts.

## Making changes later
Update the files in your GitHub repo — Render redeploys automatically
when it sees new commits on the connected branch (or trigger Manual Deploy
if auto-deploy doesn't fire).
