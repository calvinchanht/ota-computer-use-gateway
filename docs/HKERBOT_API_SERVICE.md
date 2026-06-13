# HKerBot API gateway service

HKerBot's webchat Action gateway should be owned by the user systemd service:

```text
hkerbot-api-http.service
```

Do not leave ad-hoc `node dist/index.js --config ...hkerbot.api.local.yaml` processes running outside systemd. Manual processes create restart gaps, port conflicts, and short 502 windows during deploys.

## Service contract

Unit path on `ubuntu-4gb-hel1-ops`:

```text
/home/molt/.config/systemd/user/hkerbot-api-http.service
```

Secret env path:

```text
/home/molt/hkerbot/workspace/secrets/hkerbot-api.env
```

The env file must contain `OTA_GATEWAY_BEARER_TOKEN`. Do not put bearer tokens, PATs, cookies, or other secrets inline in the unit file.

Expected unit shape:

```ini
[Unit]
Description=HKerBot webchat API gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/molt/ota-computer-use-gateway
EnvironmentFile=/home/molt/hkerbot/workspace/secrets/hkerbot-api.env
Environment=PATH=/home/molt/.nvm/versions/node/v22.22.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin
ExecStart=/home/molt/.nvm/versions/node/v22.22.2/bin/node /home/molt/ota-computer-use-gateway/dist/index.js --config /home/molt/ota-computer-use-gateway/config/hkerbot.api.local.yaml --transport http
Restart=always
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=10
TimeoutStopSec=20
KillSignal=SIGTERM

[Install]
WantedBy=default.target
```

User lingering should stay enabled so the service survives logout:

```bash
loginctl show-user molt -p Linger
```

Expected:

```text
Linger=yes
```

## Status checks

```bash
systemctl --user status hkerbot-api-http.service --no-pager
curl -fsS http://127.0.0.1:8771/healthz
```

The service process should be in this cgroup:

```text
/user.slice/user-1000.slice/user@1000.service/app.slice/hkerbot-api-http.service
```

If the process is in a `session-*.scope`, it is a manual process and should be replaced by systemd.

## Safe restart

Before restart:

```bash
npm install
npm run build
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user restart hkerbot-api-http.service
sleep 3
curl -fsS http://127.0.0.1:8771/healthz
```

If restart fails, inspect:

```bash
systemctl --user status hkerbot-api-http.service --no-pager
journalctl --user -u hkerbot-api-http.service --since '15 minutes ago' --no-pager
```

## Why this exists

A previous deploy left the service inactive and started the gateway manually. During later deploys, HKerBot observed 502 responses because the origin was briefly unavailable or port binding collided. Systemd ownership makes failures visible and restartable.


## Bounded commands need Node on PATH

HKerBot runbook/script validation often uses commands such as:

```bash
node --check scripts/example.js
```

The gateway service runs under systemd, which does not automatically inherit interactive shell or nvm PATH setup. Keep the nvm Node directory in the unit `PATH` so bounded `run_command` calls can find `node` and `npm`.

Smoke check:

```bash
npm run cli -- tool run_command ... 'command -v node && node --version'
```

Expected node path:

```text
/home/molt/.nvm/versions/node/v22.22.2/bin/node
```
