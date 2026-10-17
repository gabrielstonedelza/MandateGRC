# Deploying MandateGRC to mandategrc.app

## 1. Requirements

| Requirement | Detail |
|---|---|
| Runtime | **Node.js 22.13+** (built-in `node:sqlite`), or **Docker** using the included `Dockerfile` (Node 22, runs as non-root). No `npm install`: there are zero dependencies. |
| Machine | 1 shared vCPU and **512 MB RAM** is plenty to start. |
| Persistent disk | **1 GB volume** mounted at `/data`. The SQLite database lives there and must survive restarts and redeploys. |
| HTTPS | **Mandatory.** Passkeys only work over HTTPS (or localhost), and `.app` domains are HSTS-preloaded, so browsers refuse plain HTTP. |
| Domain | `mandategrc.app` registered (Namecheap), with access to its DNS settings. |
| Instances | **Exactly one** running instance. SQLite, sign-in challenges and rate limits are local to the process. Don't enable autoscaling or multiple machines. |
| Email forwarding | `privacy@mandategrc.app` and `legal@mandategrc.app` are published on the legal pages. Forward them to your inbox (Namecheap's free email forwarding works). |

### Environment variables

| Variable | Production value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Enables production checks. The server refuses to start without `MANDATEGRC_ORIGIN`. |
| `MANDATEGRC_ORIGIN` | `https://mandategrc.app` | Passkeys are bound to this domain, and it's used for origin checks and Secure cookies. **Never change it after users register**, or their passkeys stop working. |
| `TRUST_PROXY` | `1` | The platform's proxy terminates HTTPS. Only the proxy-appended client IP is trusted for rate limiting. |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Listen inside the container. |
| `MANDATEGRC_DATA_DIR` | `/data` | Where the database is stored (the mounted volume). |

The Docker image already sets everything except `MANDATEGRC_ORIGIN`.

### Where not to deploy

Vercel, Netlify, Cloudflare Pages/Workers, Heroku's free tier, or any serverless or "functions" platform. They have no persistent disk and run many short-lived instances, which would lose data and break sign-in.

---

## 2. Option A (recommended): Fly.io

This is the simplest managed option. It deploys the Dockerfile, provides a persistent volume and daily snapshots, and handles HTTPS certificates automatically. It costs a few dollars a month for one small machine plus a 1 GB volume; check fly.io/pricing for current rates.

```bash
# one-time
brew install flyctl
fly auth signup            # or: fly auth login
fly launch --no-deploy --copy-config --name mandategrc   # uses fly.toml; change primary_region if you like
fly volumes create mandategrc_data --size 1 --region lhr # same region as primary_region
fly deploy
fly certs add mandategrc.app
fly certs add www.mandategrc.app
```

`fly certs add` prints the DNS records to create. In **Namecheap → Domain List → Manage → Advanced DNS**, add them:

| Type | Host | Value |
|---|---|---|
| A | `@` | the IPv4 address Fly shows |
| AAAA | `@` | the IPv6 address Fly shows |
| CNAME | `www` | `mandategrc.fly.dev` |

Then run `fly certs show mandategrc.app` until the certificate is issued, usually within minutes. Open https://mandategrc.app.

**Updates:** `git pull` (or edit), then `fly deploy`. There is a brief restart; data stays on the volume.

**Backups:** Fly snapshots volumes daily. For an extra copy:

```bash
fly ssh console -C "node --disable-warning=ExperimentalWarning tools/backup.mjs"
fly ssh sftp get /data/backups/<file>.db ./mandate-backup.db
```

---

## 3. Option B: your own VPS with Docker + Caddy

Any Linux VPS works: Hetzner CX22, DigitalOcean, Linode or AWS Lightsail. This gives full control and data stays on a server you own. Caddy obtains and renews HTTPS certificates automatically.

```bash
# on the server (Ubuntu 24.04), as a sudo user
curl -fsSL https://get.docker.com | sh
git clone <your repo url> mandategrc && cd mandategrc
docker compose up -d --build
```

In Namecheap Advanced DNS, point `@` (A record) at the server's IPv4 address, and AAAA at its IPv6 if it has one. Point `www` (CNAME) at `mandategrc.app`. Open ports **80 and 443** in the server firewall.

**Updates:** `git pull && docker compose up -d --build`

**Backups:** a daily cron job, plus copying the files somewhere off the server:

```bash
0 3 * * * cd ~/mandategrc && docker compose exec -T app node --disable-warning=ExperimentalWarning tools/backup.mjs
```

---

## 4. Option C: Railway or Render

Both deploy the Dockerfile directly from GitHub. Attach a **persistent volume/disk at `/data`**: Render requires a paid instance for disks. Set `MANDATEGRC_ORIGIN=https://mandategrc.app`, keep a single instance, and add the custom domain in their dashboard (they show the DNS records to add at Namecheap).

---

## 5. Launch checklist

- [ ] `MANDATEGRC_ORIGIN=https://mandategrc.app` is set, and https://mandategrc.app/healthz returns `{"ok":true}`.
- [ ] Create your own workspace through **Get started**, and add a **second passkey** (phone or security key) under My account.
- [ ] Test sign-in on Safari (Mac/iPhone), Chrome and a phone.
- [ ] `privacy@` and `legal@mandategrc.app` forward to an inbox you read.
- [ ] Have a lawyer review the Privacy Policy and Terms (add the governing-law clause for your jurisdiction).
- [ ] Backups are confirmed: take one and restore it to a test machine once.
- [ ] Check the hosting provider's own logging policy matches what the privacy page says.

## 6. Running it locally (development)

```bash
npm start            # http://localhost:4300
npm run backup       # snapshot data/mandate.db into data/backups/
npm run docs:screenshots   # regenerate the documentation images (needs Google Chrome)
```
