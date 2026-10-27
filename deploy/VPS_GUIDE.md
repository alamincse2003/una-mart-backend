# UNA Mart — running the shop on a VPS

Everything needed to put UNA Mart on your own server and keep it healthy:
buying the server, security, domain, automatic deploys, backups, monitoring,
everyday commands, and what to do when something breaks.

Follow sections 1–6 once, in order. Sections 7–13 are for everyday use.

---

## 0. What you are running

```
            Internet (customers, admins)
                     │  HTTPS 443
        ┌────────────▼─────────────────────────────── VPS (Ubuntu 24.04) ──┐
        │  caddy   automatic HTTPS certificates, sends traffic onward      │
        │    ├─ www.unamartbd.com ──► web   (Next.js storefront + admin)   │
        │    └─ api.unamartbd.com ──► api   (NestJS API)                   │
        │                              └──► db (PostgreSQL, private)       │
        │  /opt/unamart   compose file, scripts, .env, backups/            │
        └──────────────────────────────────────────────────────────────────┘
   GitHub: push to main → tests → Docker image (ghcr.io) → SSH → deploy.sh
```

- All four parts run as **Docker containers** on one server, started by
  `docker compose`. They restart automatically after a crash or a reboot.
- **The server never builds code.** GitHub Actions tests and builds the images.
  The server only downloads ("pulls") them. That keeps a small server fast.
- **Nothing is reachable from the internet except ports 80/443 (Caddy) and
  SSH.** The database only listens inside the server.

**Monthly cost:** a VPS about $12–24, the domain about $10/year, and offsite
backups free (Cloudflare R2 free tier). A card is needed for most VPS
providers.

---

## 1. Buy the VPS

| Setting | Choose |
|---|---|
| Location | **Singapore** (closest to Bangladesh = fastest pages) |
| Operating system | **Ubuntu 24.04 LTS** |
| Size | **2 vCPU, 4 GB RAM, 80 GB SSD** (2 GB RAM works to start, 4 GB is comfortable) |
| Extras | Turn on the provider's **automatic snapshots/backups** if offered (~20% extra; a second safety net) |

Providers with a Singapore region: DigitalOcean, Vultr, Linode (Akamai),
AWS Lightsail, Hetzner. Compare current prices yourself; they change.

During creation, **add an SSH key** instead of a password (step 2.1 shows
how to make one). Note the server's **public IP address**.

> Put the VPS on an account owned by UNA Mart (both founders have access),
> not on an employer's or a personal account you might lose.

---

## 2. Your SSH key and first login

### 2.1 Make an SSH key on your Windows PC (once per person)

PowerShell:

```powershell
ssh-keygen -t ed25519 -C "alamin-pc"
# press Enter for the default location; set a passphrase
Get-Content $HOME\.ssh\id_ed25519.pub   # this PUBLIC key goes to the VPS provider
```

Never share `id_ed25519` (without `.pub`). That file is your private key.

### 2.2 First login

```powershell
ssh root@<server-ip>
```

---

## 3. Secure and prepare the server (once)

### 3.1 Run the setup script

On the server, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/alamincse2003/una-mart-backend/main/deploy/server-setup.sh -o setup.sh
less setup.sh      # read what it does (q to quit)
bash setup.sh
```

It does the following:

- installs updates, and turns on **automatic security updates**;
- sets the timezone to Asia/Dhaka and adds 2 GB swap;
- installs Docker, with log rotation so logs can't fill the disk;
- turns on the **firewall**, allowing only SSH, 80 and 443;
- turns on **fail2ban**, which blocks IPs that keep guessing SSH passwords;
- creates the `deploy` user, which owns `/opt/unamart` and can run Docker;
- schedules the **nightly database backup at 03:00**.

> If the repository is private, `curl` can't download the script. Copy it
> from your PC instead:
> `scp deploy/server-setup.sh root@<server-ip>:setup.sh`

### 3.2 Check that the `deploy` user works

From a **new** PowerShell window (keep the root one open):

```powershell
ssh deploy@<server-ip>
docker ps          # should print an empty table, not "permission denied"
```

### 3.3 Turn off password and root login

Do this only after 3.2 works. On the server, as root:

```bash
cat > /etc/ssh/sshd_config.d/99-unamart.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh
```

Test once more with `ssh deploy@<server-ip>` from a new window before you
close the root session. From now on, use `deploy`. For admin tasks, the
provider's web console still works if SSH ever fails.

### 3.4 Give your co-founder access

Add their public key (their own step 2.1) as a new line in
`/home/deploy/.ssh/authorized_keys`. To remove someone's access, delete
their line.

---

## 4. Domain and DNS

In Cloudflare (or wherever the domain's DNS is) add three records, all
pointing to the server IP. Set them to **DNS only** (grey cloud, not orange):

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` (unamartbd.com) | `<server-ip>` | DNS only |
| A | `www` | `<server-ip>` | DNS only |
| A | `api` | `<server-ip>` | DNS only |

**Why DNS only?** Caddy gets the HTTPS certificates itself. The API also
counts exactly one proxy in front of it, so it sees real customer IPs for
its rate limits.

Check propagation from your PC with `nslookup api.unamartbd.com`. It should
show the server IP; this can take a few minutes.

---

## 5. Configure the app on the server (once)

Log in as `deploy`, then:

### 5.1 Secrets file

```bash
cd /opt/unamart
nano .env
```

Paste the contents of `deploy/.env.example` from the backend repo and fill
it in. Generate each random value with `openssl rand -hex 32` (one per
value: `POSTGRES_PASSWORD`, `OTP_SECRET`). Then lock the file:

```bash
chmod 600 .env
```

**Save a copy of the finished `.env` in a password manager.** Without
`POSTGRES_PASSWORD` you cannot use your own backups on a new server.

For the private preview keep `APP_ENV=staging` and `SMS_PROVIDER=console`
(section 11 switches to the public shop).

### 5.2 Let the server download your private images

On GitHub, go to **Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token**. Give it the scope **`read:packages`**
only, with no expiry or a long one. Then, on the server:

```bash
echo <the-token> | docker login ghcr.io -u alamincse2003 --password-stdin
```

---

## 6. Connect GitHub and deploy for the first time

### 6.1 A deploy key for GitHub Actions

On your PC (PowerShell):

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\unamart_deploy -C "github-actions" -N '""'
Get-Content $HOME\.ssh\unamart_deploy.pub
```

Add that public line to `/home/deploy/.ssh/authorized_keys` on the server.

### 6.2 Secrets and variables, in **both** repositories

GitHub repo → **Settings → Secrets and variables → Actions**.

**Secrets** (both `una-mart-backend` and `una-mart-frontend`):

| Secret | Value |
|---|---|
| `SSH_HOST` | server IP |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | full contents of `$HOME\.ssh\unamart_deploy` (the file **without** `.pub`) |

**Variables:**

| Repo | Variable | Value |
|---|---|---|
| both | `DEPLOY_ENABLED` | `true` |
| frontend | `NEXT_PUBLIC_API_URL` | `https://api.unamartbd.com/v1` |
| frontend | `NEXT_PUBLIC_SITE_URL` | `https://www.unamartbd.com` |
| frontend | `NEXT_PUBLIC_APP_ENV` | `staging` |

Recommended: under **Settings → Environments → production**, add both
founders as required reviewers if you want to approve every deploy by hand.
Leave it off for fully automatic deploys.

### 6.3 First deploy, backend first

1. In `una-mart-backend`, go to **Actions → CI / Deploy → Run workflow** on
   `main`. It tests, builds, copies the server files to `/opt/unamart`, runs
   migrations and starts the API and Caddy.
2. Then do the same in `una-mart-frontend`.
3. Load the starting data and create your admin account (on the server):

   ```bash
   cd /opt/unamart
   ./dc run --rm api node_modules/.bin/tsx prisma/seed.ts
   ./dc run --rm -it api node_modules/.bin/tsx scripts/create-admin.ts --phone 017XXXXXXXX --name "Your Name"
   ```

   The seed loads the delivery zones **and the demo catalog** (with demo
   ratings). That's fine for staging. Archive the demo products in the
   admin panel before going public.
4. Open `https://www.unamartbd.com`. You should see the yellow **Preview
   site** strip. Place a test order. The checkout code appears in the API
   log:

   ```bash
   ./dc logs --tail 50 api | grep "code is"
   ```

From now on **every push to `main` deploys automatically** if the tests
pass. Pull requests only run the tests.

---

## 7. Everyday operations

Always `cd /opt/unamart` first, and use **`./dc`** instead of
`docker compose`. It knows which image versions are deployed.

| Task | Command |
|---|---|
| What's running and healthy? | `./dc ps` |
| Follow the API log | `./dc logs -f --tail 100 api` (Ctrl+C to stop) |
| Storefront / Caddy log | `./dc logs --tail 100 web` / `caddy` |
| Restart a part | `./dc restart api` |
| Deployed versions | `cat tags.env` (git commit SHAs) |
| Roll back to an earlier version | `./deploy.sh web <older-sha>` (any SHA from the repo's commit list) |
| Redeploy the current image | `SKIP_PULL=1 ./deploy.sh api $(grep API_TAG tags.env \| cut -d= -f2)` |
| Create / reset an admin | `./dc run --rm -it api node_modules/.bin/tsx scripts/create-admin.ts --phone … --name "…"` |
| Disk space | `df -h /` and `docker system df` |
| Free disk (old images) | `docker image prune -a` (only removes images not in use) |

### How a deploy works (`deploy.sh`)

1. Waits if another deploy is running (web and API never deploy at once).
2. Pulls the new image.
3. **API only:** backs up the database, then applies migrations.
4. Starts the new container and waits up to 2 minutes for its health check.
5. Healthy: done. **Not healthy: puts the previous version back
   automatically** and the GitHub run turns red.

Migrations are **not** rolled back. Keep schema changes backward compatible:
add a column in one release, and remove the old one in a later release.

### Looking at the database from your PC

```powershell
ssh -L 5433:127.0.0.1:5432 deploy@<server-ip>
```

While that window is open, connect any database tool (pgAdmin, DBeaver,
`prisma studio`) to `localhost:5433` with the user, password and database
name from `/opt/unamart/.env`. Be careful: this is the live shop.

---

## 8. Backups

| What | When | Where | Kept |
|---|---|---|---|
| Database dump | every night 03:00 | `/opt/unamart/backups/` | 14 days |
| Database dump | before every API deploy | same | 14 days |
| Database dump | each night, if configured | off the server (rclone) | as long as you like |
| Whole-server snapshot | if enabled at the provider | provider | provider's policy |

A backup that lives only on the same server dies with the server. **Set up
offsite copies before launch:**

1. Create a free **Cloudflare R2** bucket (`unamart-backups`) and an R2 API
   token with read and write access.
2. On the server: `rclone config` → new remote `r2` → type `s3` → provider
   `Cloudflare` → paste the key, secret and endpoint.
3. In `/opt/unamart/.env` set `BACKUP_REMOTE=r2:unamart-backups`.
4. Test with `./backup.sh manual`. It should print `Copied to r2:unamart-backups`.

**Restore** (replaces all current data; the shop is offline while it runs):

```bash
ls -lt backups/ | head        # pick a file
./restore.sh backups/unamart-YYYYMMDD-HHMMSS-nightly.dump
```

It asks you to type `RESTORE`, and takes a safety backup of the current data
first. To restore from R2 onto a new server, run
`rclone copy r2:unamart-backups/<file> backups/` first.

**Practise a restore once a month** on a test machine or staging. A backup
you have never restored is a hope, not a backup.

The files that are *not* in the database (`.env`, `tags.env`) must be in your
password manager. Everything else comes back from GitHub.

---

## 9. Monitoring and alerts

| What | How | Cost |
|---|---|---|
| Site down | **UptimeRobot** (or Better Stack): monitor `https://www.unamartbd.com` and `https://api.unamartbd.com/health` every 5 min, with alerts by email or app to both founders | free |
| Failed deploy | GitHub emails you when a workflow fails. Keep notifications on. | free |
| Certificates | Caddy renews them by itself. Let's Encrypt emails `ACME_EMAIL` if something is wrong. | free |
| Disk full | Check `df -h /` monthly. Docker logs are capped at 50 MB per container. | — |
| App errors | `./dc logs api`. Add Sentry later for alerts on crashes. | free tier |

`/health` returns `{"status":"ok","database":"up"}`. A 503 means the API
can't reach the database.

---

## 10. Security maintenance

- **Security updates install automatically.** Some need a reboot. Check
  monthly:
  `cat /var/run/reboot-required 2>/dev/null && echo "reboot needed"`.
  Reboot at a quiet hour with `sudo reboot` (containers come back by
  themselves within a minute).
- **Only SSH keys, no passwords, no root login** (step 3.3). Remove keys
  of anyone who leaves.
- **Secrets** live only in `/opt/unamart/.env` (permissions 600) and the
  password manager, never in git or chat. If a secret leaks:
  - change `OTP_SECRET` in `.env`, then `./dc up -d api` (pending codes stop
    working; harmless);
  - for a leaked `POSTGRES_PASSWORD`, change it inside Postgres
    (`ALTER USER … PASSWORD …`) **and** in `.env`, then restart `api`;
  - regenerate the GitHub token from 5.2 or the deploy key from 6.1 if
    either leaks.
- **Firewall:** `sudo ufw status` should show only 22, 80 and 443. Docker
  can publish ports past ufw, so never add a public `ports:` entry for
  `db`, `api` or `web` in `docker-compose.yml`. Only Caddy is public.
- **Keep base images current:** every deploy pulls the latest Node and
  Postgres patch images. Postgres itself updates with
  `./dc pull db && ./dc up -d db` (backup first).

---

## 11. From private preview to the public shop

All of these must be true:

- [ ] A real SMS gateway is integrated, and `SMS_PROVIDER` is set to it in `.env`
- [ ] `APP_ENV=production` in `/opt/unamart/.env`, then `./dc up -d api`
- [ ] Frontend variable `NEXT_PUBLIC_APP_ENV` emptied, then redeploy the
      frontend (re-run its workflow). This removes the preview strip and
      the noindex tag.
- [ ] Demo products and demo ratings archived or replaced with the real catalog
- [ ] Offsite backups working (section 8), and one restore practised
- [ ] Uptime monitors on (section 9)
- [ ] Policy pages (returns, shipping, terms, privacy) checked
- [ ] A real test order end to end on a phone, including cancel

---

## 12. When to grow

| Sign | Do |
|---|---|
| Server RAM constantly above 80% (`free -h`) | Resize the VPS at the provider (a few minutes downtime) |
| Database over a few GB, or many orders a minute | Move Postgres to a managed database. Only `DATABASE_URL` changes. |
| You need zero-downtime deploys or a second server | Move rate limits out of memory, then add a load balancer (a bigger project) |

One 4 GB server comfortably handles a new shop's first thousands of daily
visitors.

---

## 13. Troubleshooting

| Symptom | Check | Fix |
|---|---|---|
| Site shows a certificate error right after setup | `./dc logs caddy` | DNS not pointing to the server yet, or records proxied (orange). Fix DNS, then `./dc restart caddy`. |
| `502 Bad Gateway` | `./dc ps` | A container is down. Read its logs and restart it. If a deploy just failed, the rollback is in its log. |
| API says database down (503 on /health) | `./dc ps db`, `df -h /` | Disk full or db stopped: free space, then `./dc up -d db`. |
| GitHub deploy fails at SSH | Action log | `SSH_HOST`, `SSH_USER` or `SSH_PRIVATE_KEY` is wrong, or the deploy key is missing from `authorized_keys`. |
| Deploy fails with "denied" pulling the image | `docker login ghcr.io` | The token from 5.2 expired. Make a new one and log in again. |
| Login cookie not kept / "BAD_ORIGIN" | Browser URL | Use `https://www.…` (the API only accepts the shop's own address). Check `SITE_DOMAIN` in `.env`. |
| Customers never get the code | `./dc logs api` | Expected while `SMS_PROVIDER=console` (staging). |
| Server slow | `top`, `free -h`, `docker stats` | Resize the VPS, or look for a stuck container. |
| Locked out of SSH | Provider's web console | Log in there and fix `authorized_keys` or `sshd_config`. |

---

## Monthly checklist (15 minutes)

- [ ] `./dc ps`: all four are up, and `api`/`web` are `healthy`
- [ ] Recent files in `backups/` and in the R2 bucket
- [ ] Reboot needed? (section 10)
- [ ] `df -h /` below 70%
- [ ] Uptime monitor history: any outages?
- [ ] Practise a restore (section 8) every month or two
