# CX Hub — deploy on Render

This is a small standalone app: one page listing your Tools, Forms & Trackers,
and Guides & SOPs, with search and an "Add link" button. Anyone with the URL
can view it; only people who know the **edit password** can add or remove links.

## What's in this folder
- `server.js` — the backend (serves the page + a small API)
- `public/index.html` — the page people see
- `data.json` — the starting list of links (this file gets updated automatically as people add/remove links)
- `package.json` — tells Render what to install and how to start the app

## Step 1 — Put this on GitHub
1. Go to [github.com](https://github.com) and sign in (or create a free account).
2. Click **New repository**. Name it something like `cx-hub`. Leave it **empty** (don't check "Add a README").
3. Click **Create repository**.
4. On the next page, click **uploading an existing file**.
5. Drag in every file from this folder (keep the `public` folder structure — drag the whole `public` folder in too).
6. Click **Commit changes**.

## Step 2 — Deploy on Render
1. Go to [render.com](https://render.com) and sign up (you can sign in with your GitHub account — this makes the next step easier).
2. Click **New +** → **Web Service**.
3. Connect the `cx-hub` repository you just created.
4. Fill in:
   - **Name**: `cx-hub` (or whatever you like — this becomes part of your URL)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Before clicking **Create Web Service**, scroll to **Environment Variables** and add one:
   - **Key**: `EDIT_PASSWORD`
   - **Value**: a password of your choice — this is what you'll share with people you want to allow to edit
6. Click **Create Web Service**. Render will build and deploy — this takes a couple of minutes the first time.
7. Once it's live, Render gives you a URL like `https://cx-hub.onrender.com` — that's your CX Hub. Share this in Slack.

## How editing works
- Anyone who opens the link can view and search.
- At the bottom of the page there's a **"🔒 Enable edit access"** link. Clicking it asks for a password.
- Only people who type the correct `EDIT_PASSWORD` see the "+ Add link" button and the ✕ remove buttons.
- Share the password only with people you want to be able to edit. To revoke someone's access, change `EDIT_PASSWORD` in Render's environment variables (under your service → **Environment**) and re-share the new password with the people you still want to have it.

## Important limitations to know about (free tier)
- **Spin-down delay**: Render's free tier "sleeps" the app after 15 minutes of no traffic. The first visit after a quiet period can take 30–50 seconds to load while it wakes up. This is normal on the free plan.
- **Data resets on redeploy**: Links added through the app are saved to `data.json` on Render's server, but if you push a code update (redeploy), that file resets back to whatever is in your GitHub repo. For a small internal tool with infrequent updates this is usually fine, but it's worth knowing.
  - If this becomes a problem, the fix is to add a **Render persistent disk** (a small paid add-on, roughly $1/month) mounted at, say, `/data`, and set the `DATA_FILE` environment variable to `/data/data.json`. The app already reads this from an environment variable, so no code changes are needed — just add the disk and the env var in Render's dashboard.

## Making changes later
Any time you want to change the code (design, features, etc.), update the files in your GitHub repo — Render automatically redeploys when it sees new changes pushed to the connected branch.
