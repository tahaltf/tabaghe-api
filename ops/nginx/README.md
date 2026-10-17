# Gitea IP allowlist (nginx)

Admin panel writes this snippet and reloads nginx so new IPs apply immediately.

## 1. Shared file path

Point API and nginx at the **same** path, e.g. on the host:

```bash
GITEA_IP_ALLOWLIST_FILE=/etc/nginx/snippets/gitea-ip-allowlist.conf
GITEA_IP_FORBIDDEN_HTML=/var/www/gitea-forbidden/gitea-ip-forbidden.html
GITEA_IP_ALLOWLIST_RELOAD_CMD='sudo -n nginx -t && sudo -n nginx -s reload'
```

If the API runs in Docker, bind-mount those host paths into the container (writable).
Otherwise the API writes only inside the container and **host nginx never sees the new IPs**.

### Docker (Tabagheh production)

In `docker-compose` for `backend`:

```yaml
volumes:
  - /etc/nginx/snippets/gitea-ip-allowlist.conf:/app/ops/nginx/gitea-ip-allowlist.conf
  - /var/www/gitea-forbidden/gitea-ip-forbidden.html:/app/ops/nginx/gitea-ip-forbidden.html
  - /var/run/docker.sock:/var/run/docker.sock
```

In `api/.env`:

```bash
GITEA_IP_ALLOWLIST_FILE=/app/ops/nginx/gitea-ip-allowlist.conf
GITEA_IP_FORBIDDEN_HTML=/app/ops/nginx/gitea-ip-forbidden.html
# Host nginx (SSL for git.tabagheh.com) — needs docker.sock mounted:
GITEA_IP_ALLOWLIST_RELOAD_CMD=docker run --rm --privileged --pid=host alpine:3.20 nsenter -t 1 -m -u -i -n -- sh -c "nginx -t && nginx -s reload"
```

One-shot apply if reload failed from admin UI:

```bash
cd /app/tabagheh
docker compose cp backend:/app/ops/nginx/gitea-ip-allowlist.conf /etc/nginx/snippets/gitea-ip-allowlist.conf
nginx -t && systemctl reload nginx
```

## 2. Include in the Gitea vhost

```nginx
server {
    server_name git.tabagheh.com;

    include /etc/nginx/snippets/gitea-ip-allowlist.conf;

    error_page 403 /gitea-ip-forbidden.html;
    location = /gitea-ip-forbidden.html {
        alias /var/www/gitea-forbidden/gitea-ip-forbidden.html;
        default_type text/html;
    }

    # ... proxy_pass to Gitea ...
}
```

## 3. Passwordless reload for the API user

```
# /etc/sudoers.d/tabagheh-gitea-ip
tabagheh-api ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload
```

Without this (or the Docker reload cmd above), the API can write the file but nginx keeps the old ACL until a manual reload.

## 4. Verify

1. Add an IP in Admin → دسترسی Gitea
2. Sync message should contain `nginx reload OK`
3. That IP can reach `git.tabagheh.com` without restarting the server

---

# Crawler IP allowlist (nginx)

Same pattern as Gitea, for `crawler.tabagheh.com`.

## Env

```bash
CRAWLER_IP_ALLOWLIST_FILE=/etc/nginx/snippets/crawler-ip-allowlist.conf
CRAWLER_IP_FORBIDDEN_HTML=/var/www/crawler-forbidden/crawler-ip-forbidden.html
CRAWLER_IP_ALLOWLIST_RELOAD_CMD='sudo -n nginx -t && sudo -n nginx -s reload'
CRAWLER_IP_ALLOWLIST_ALWAYS=127.0.0.1
```

Docker bind-mounts (backend service):

```yaml
volumes:
  - /etc/nginx/snippets/crawler-ip-allowlist.conf:/app/ops/nginx/crawler-ip-allowlist.conf
  - /var/www/crawler-forbidden/crawler-ip-forbidden.html:/app/ops/nginx/crawler-ip-forbidden.html
```

## Vhost

See `crawler.tabagheh.com.conf.example` in this folder. Include the snippet and 403 page the same way as Gitea.

## Verify

1. Admin → دسترسی کرالر (IP)
2. Add your office/laptop IP, enable enforcement
3. Sync message should contain `nginx reload OK`
4. Unlisted IPs get the branded 403 page on `crawler.tabagheh.com`
