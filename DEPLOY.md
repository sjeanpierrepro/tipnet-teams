# Publishing TipNet Teams

TipNet Teams is a static website: the folder `app/` is the whole product. It is published on GitHub Pages from its own GitHub repository, and it is served at `https://teams.tipmynet.com` (DNS at Cloudflare). Until that record exists, the free `https://USERNAME.github.io/tipnet-teams/` link works (all links inside the app are relative, so nothing changes when you add the domain).

## Publishing an update

1. **GitHub Desktop:** review your changes in the list.
2. **Commit to main** with a short message (like "Fix budget calculations").
3. **Push origin** (top bar).
4. Open GitHub in your browser, go to your repository **Actions** tab. A green check appears in 1 to 2 minutes.
5. Tell staff to open TipNet Teams. They see "Update available: Refresh" at the bottom of the page and tap it.

**Important:** before you push, bump `VERSION` in `app/sw.js`. Change the number at the end (for example `tipnetteams-v1` to `tipnetteams-v2`; always one higher than what is there now). Without this, phones keep their old cached version. The one exception is `app/js/billing-config.js` on its own: installed apps refresh it in the background.

---

## First-time setup: a new GitHub repository plus GitHub Pages

TipNet Teams has its own repository. Do not reuse the repository of any other app.

### Step 1: Create a GitHub account (skip if you have one)
1. Go to https://github.com and click **Sign up**.
2. Pick a username. It becomes part of your free link (`https://USERNAME.github.io/REPO/`).
3. Confirm your email.

### Step 2: Create the repository and publish the folder

**Easiest: GitHub Desktop** (https://desktop.github.com)
1. Install GitHub Desktop and sign in.
2. **File > Add local repository...** and choose the TipNet Teams folder. (It is already a git repository, so you do not need to create one.)
3. Click **Publish repository** (top bar).
4. Pick a repository name (for example `tipnet-teams`). **Uncheck "Keep this code private"** (GitHub Pages is free only for public repositories).
5. Click **Publish repository**.

**Alternative: upload in the browser**
1. On github.com click **+** (top right) > **New repository**.
2. Name it, choose **Public**, leave "Add a README" unchecked, click **Create repository**.
3. Click **uploading an existing file**.
4. Open the project folder in File Explorer, select **every** file and folder (`app`, `tests`, `.github`, `package.json`, the `.md` files, and so on) and drag them onto the page. Make sure `.github` is included; without it nothing deploys. Do **not** drag the `.git` folder.
5. Click **Commit changes**.

### Step 3: Turn on GitHub Pages
1. In your repository click **Settings** (top bar).
2. In the left sidebar click **Pages**.
3. Under **Build and deployment > Source**, choose **GitHub Actions**.

### Step 4: Run the deploy
1. Click the **Actions** tab.
2. The first run (from Step 2) may show a red X. That is expected: Pages was not turned on yet.
3. Click **Deploy to GitHub Pages** in the left list, then **Run workflow** (right side) > **Run workflow**.
4. Wait for the green check (about 1 to 2 minutes).

Your app is live at `https://USERNAME.github.io/tipnet-teams/`. The manager page is at `/teams/` on the same address. Share `https://teams.tipmynet.com` once it is set up (next section).

---

## The address: teams.tipmynet.com

TipNet Teams lives at **https://teams.tipmynet.com**, a subdomain of the owner's existing domain, published from its **own** GitHub repository and Pages site (`tipnet-teams`). It has its own web address, so its own storage and service worker. It is deliberately not `tipmynet.com/teams`: that would share the consumer app's service worker scope and its saved data. Nothing in the app depends on the address (all links are relative), and the contact email stays hello@tipmynet.com.

1. **Publish the repository** (First-time setup above): GitHub Desktop > **Publish repository**, name `tipnet-teams`, public.
2. **Pages source.** Repository **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. **Custom domain.** Same page, **Custom domain**: type `teams.tipmynet.com`, **Save**. Wait for the DNS check to pass, then tick **Enforce HTTPS**.
4. **Cloudflare DNS: one record.** Cloudflare > the tipmynet.com domain > **DNS > Records > Add record**: type `CNAME`, name `teams`, target `sjeanpierrepro.github.io`, proxy status **DNS only** (grey cloud).
5. **Domain verification.** The account's GitHub Pages verification for tipmynet.com already exists and covers its subdomains. Keep its `TXT` record.
6. **No CNAME file.** The deploy workflow publishes the `app` folder with GitHub Actions, and the custom domain is stored in the Pages settings, so the repository needs no `CNAME` file. Do not add one.
7. **Tell Lemon Squeezy.** Set the confirmation-modal and receipt button links to `https://teams.tipmynet.com/` (PAYMENTS.md).
8. **Email.** The contact email stays `hello@tipmynet.com` (Cloudflare Email Routing on the main domain). Nothing to change.

The manager page is at `https://teams.tipmynet.com/teams/`.

**Saved data belongs to the web address.** If you ever test on the `github.io` link first, anyone who used it keeps their nights there. To move: in that app, Setup > Backups > **Save a backup file**; then open `https://teams.tipmynet.com`, install it, and restore that file before entering anything (restoring replaces what is saved there). Hand out QR posters and links only once the address is final.

---

## Option 2: Netlify Drop (quick test link)

1. Go to https://app.netlify.com/drop.
2. Drag the **`app` folder** (the one containing `index.html`) onto the page.
3. Netlify gives you a link like `https://random-name.netlify.app/`.

Drops without an account are temporary. Create a free account and claim the site to keep the link. To update, drag the `app` folder again onto the site's **Deploys** page.

---

## Notes

- **HTTPS is required** for offline use and install. Both hosts use HTTPS.
- **Same link after updates.** Staff do not need a new link when you redeploy.

---

## Troubleshooting

**Actions shows a red X on the first run**
Expected if Pages was not enabled yet. Do Step 3, then Step 4 (Run workflow).

**No "Deploy to GitHub Pages" workflow in the Actions tab**
The `.github` folder was not uploaded. Upload it (show hidden items in File Explorer), or use GitHub Desktop, which includes it automatically.

**The test job fails**
Open the failed run to see which test failed. Fix it locally (`npm test`), then push again.

**"404 / Page not found" at the link**
- Check Settings > Pages says "Your site is live at ...". If not, run the workflow again (Step 4).
- Without a custom domain, the link ends in `/REPO/` and must match the repository name exactly.
- Wait a minute after a green check; the first publish can lag.

**Staff still see the old version**
They get an "Update available: Refresh" bar. If you forgot to bump `VERSION` in `app/sw.js`, bump it and push again.

**Need help?** GitHub: https://docs.github.com/pages. Cloudflare: https://developers.cloudflare.com/dns/. Netlify: the **Support** link in the dashboard.
