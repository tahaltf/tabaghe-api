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

Without this, the API can write the file but nginx keeps the old ACL until a manual reload.

## 4. Verify

1. Add an IP in Admin → دسترسی Gitea
2. Sync message should contain `nginx reload OK`
3. That IP can reach `git.tabagheh.com` without restarting the server
