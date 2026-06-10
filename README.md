# 🎵 Spotify Library Explorer

A beautiful, private app that runs on your own computer and lets you explore your entire Spotify library — search, filter, sort by genre, year, popularity, playlist, top tracks, and more. Export everything to CSV with one click.

**No coding experience needed. Free forever.**

---

## What it looks like

You get a clean table of every song you've ever liked or added to a playlist, with filters for genre, release year, popularity, explicit content, your top tracks, and more. You can select songs and save them as a new Spotify playlist, or export your whole library (or just your filtered results) to a spreadsheet.

---

## What you'll need

- A computer (Mac or Windows)
- A Spotify account (free or paid works)
- Node.js installed on your computer (free — see Step 1)

---

## Step 1 — Install Node.js

Node.js is free software that lets your computer run the app. You only need to do this once.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Click the big button that says **"Download Node.js (LTS)"**
3. Open the file that downloads and follow the installer (just keep clicking Next/Continue)
4. When it's done, you're set

---

## Step 2 — Get your Spotify API credentials

This sounds technical but it's just a few clicks on Spotify's website. You're basically registering the app so Spotify knows it's yours.

1. Go to **[developer.spotify.com](https://developer.spotify.com)** and click **Log In** (use your normal Spotify username and password)

2. Once logged in, click your **profile picture** in the top right, then click **Dashboard**

3. Click the **"Create app"** button

4. Fill in the form:
   - **App name:** anything you like, e.g. `My Library Explorer`
   - **App description:** anything, e.g. `Personal library tool`
   - **Redirect URI:** copy and paste this exactly → `http://127.0.0.1:8888/callback`
   - **Which API/SDKs are you planning to use?** → tick **Web API**

5. Click **Save**

6. You'll land on your app's page. You'll see a long string of letters and numbers — that's your **Client ID**. Copy it somewhere (Notes app, a text file, whatever).

7. Click **"View client secret"** — copy that too. Keep it private, like a password.

---

## Step 3 — Set up the file

1. Download **`spotify_explorer.js`** from this page:
   - Click the filename above
   - Click the download button (looks like a down arrow ↓) in the top right of the file view

2. Open the file in a plain text editor:
   - **Mac:** right-click the file → Open With → **TextEdit**. If TextEdit opens it with formatting, go to Format menu → Make Plain Text
   - **Windows:** right-click the file → Open With → **Notepad**

3. At the very top of the file you'll see these three lines. Fill them in with your details:

   ```
   const YOUR_NAME     = 'your name here';
   const CLIENT_ID     = 'YOUR_CLIENT_ID_HERE';
   const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';
   ```

   For example:
   ```
   const YOUR_NAME     = 'alex';
   const CLIENT_ID     = 'abc123def456...';
   const CLIENT_SECRET = 'xyz789...';
   ```

4. Save the file (Cmd+S on Mac, Ctrl+S on Windows)

---

## Step 4 — Run the app

**On Mac:**

1. Open the **Terminal** app — press **Cmd + Space**, type `Terminal`, hit Enter
2. Type `cd ` (cd followed by a space), then **drag the folder** containing `spotify_explorer.js` into the Terminal window. Hit Enter.
3. Type this and hit Enter:
   ```
   node spotify_explorer.js
   ```

**On Windows:**

1. Open the **folder** containing `spotify_explorer.js` in File Explorer
2. Click the **address bar** at the top of the window (where it shows the folder path), type `cmd`, and hit Enter — a black window opens
3. Type this and hit Enter:
   ```
   node spotify_explorer.js
   ```

---

## Step 5 — Use it

1. Open your browser (Chrome, Safari, Firefox — anything) and go to:
   ```
   http://127.0.0.1:8888
   ```

2. Click **"connect spotify"** and log in with your Spotify account

3. Click **"fetch library"** — the first time this runs it pulls all your songs, playlists, genres, and top track rankings from Spotify. It can take a few minutes depending on how big your library is.

4. Once it's done, you can search, filter, sort, and explore. Your library is saved locally so next time it loads instantly from the cache.

> **To stop the app:** go back to Terminal/Command Prompt and press **Ctrl+C**
>
> **To start it again next time:** just repeat Step 4 — your library will load from the saved cache immediately

---

## Features

- 🔍 Search by track, artist, or album
- 🎸 Filter by genre, playlist, release year, album type, explicit content
- 📊 Sort by popularity, year, artist, top tracks, and more
- ❤️ See which songs are in your Liked Songs vs playlists
- 🏆 See your top tracks (last 4 weeks, 6 months, all time)
- 🎵 30-second preview playback in the browser
- 💿 Save filtered selections as a new Spotify playlist
- 📥 Export to CSV — exports whatever you're currently viewing (filtered or full library)

---

## Troubleshooting

**"node: command not found" or "node is not recognized"**
→ Node.js didn't install correctly. Try downloading and installing it again from [nodejs.org](https://nodejs.org), then restart your Terminal/Command Prompt.

**"Error: listen EADDRINUSE"**
→ The app is already running. Either use the existing window in your browser, or stop the old one first (Ctrl+C in Terminal) then run it again.

**The page loads but "connect spotify" doesn't work / shows an error**
→ Double-check that your Client ID and Client Secret are copied correctly (no extra spaces), and that you added `http://127.0.0.1:8888/callback` exactly as the Redirect URI in your Spotify app settings.

**"fetch library" runs but shows 0 tracks**
→ Make sure you accepted all the permission screens when connecting. Try clicking "connect spotify" again to re-authorize.

---

## Privacy

Everything runs on your own computer. Your Spotify data never leaves your machine — the app talks directly to Spotify's API using your own credentials. No servers, no accounts, no tracking.

---

## Support this project

This is free and always will be. If it saved you time or made you happy, you're welcome to buy me a coffee ☕

**[💛 Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=44R6QCUTEDHHC)**

No pressure at all — enjoy your library explorer!
