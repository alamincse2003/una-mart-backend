#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS for UNA Mart. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/alamincse2003/una-mart-backend/main/deploy/server-setup.sh -o setup.sh
#   less setup.sh        # read it first
#   bash setup.sh
#
# Safe to re-run. It does NOT disable SSH password login — do that by hand
# after confirming key login works (VPS_GUIDE.md step 3), so you can't
# lock yourself out.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

DEPLOY_USER=deploy
APP_DIR=/opt/unamart

echo "==> System updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades rclone

echo "==> Timezone: Asia/Dhaka (cron times and logs in local time)"
timedatectl set-timezone Asia/Dhaka

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> 2 GB swap (protects against out-of-memory crashes)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
systemctl restart docker

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban (blocks repeated SSH login attempts)"
systemctl enable --now fail2ban

echo "==> Deploy user '$DEPLOY_USER' (used by GitHub Actions and by you)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p "/home/$DEPLOY_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  cat /root/.ssh/authorized_keys >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  sort -u -o "/home/$DEPLOY_USER/.ssh/authorized_keys" "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
chmod 700 "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || true
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

echo "==> App directory $APP_DIR"
mkdir -p "$APP_DIR/backups"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==> Nightly database backup at 03:00"
CRON_LINE="0 3 * * * $APP_DIR/backup.sh nightly >> $APP_DIR/backups/backup.log 2>&1"
( crontab -u "$DEPLOY_USER" -l 2>/dev/null | grep -v 'backup.sh' ; echo "$CRON_LINE" ) | crontab -u "$DEPLOY_USER" -

echo
echo "Done. Next (VPS_GUIDE.md):"
echo "  1. From your PC: ssh $DEPLOY_USER@<server-ip>   (must work before step 2)"
echo "  2. Disable SSH password + root login (step 3 of the guide)"
echo "  3. Create $APP_DIR/.env from deploy/.env.example"
