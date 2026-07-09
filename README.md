# BriskBastion

SSH-комбайн для Windows: терминал, ключи, SFTP, sync и сценарии автоматизации.

## Stack

- **Core:** Rust (`russh`, `russh-sftp`, SQLite, AES-GCM key vault)
- **Desktop:** Tauri 2 + React + TypeScript + Tailwind + xterm.js

## Features

- SSH terminal with xterm.js (WebGL renderer, PTY resize)
- Server list with password / key authentication
- Known host verification with trust dialog
- ED25519 key generation, import from `~/.ssh`, ssh-copy-id
- Dual-panel SFTP file browser (local Windows FS + remote)
- rsync-like sync engine (mtime + size diff, dry-run, push/pull)
- `.bastion` scenario runner with presets (apt upgrade, deploy site, docker prune)
- **Monitor** — host processes (ps/proc), Docker containers, trusted binary registry (SHA256)
- **Updates** — apt/dnf upgradable packages, CVE hints via OSV.dev (cached 24h)

## Development

### Prerequisites

- Rust 1.85+
- Node.js 20+
- WebView2 (Windows)

### Run

**Development** (frontend + backend together):

```bash
npm install
npm run tauri dev
```

Do **not** use plain `cargo run` for day-to-day dev — the window loads `http://localhost:1420`, which is Vite. Without it you get `ERR_CONNECTION_REFUSED`.

If you prefer two terminals:

```bash
# terminal 1
npm run dev

# terminal 2
cargo run -p brisk-bastion
```

**Production-like** (embedded UI, no dev server):

```bash
npm run build
cargo run -p brisk-bastion --release
```

### Build

```bash
npm run tauri build
```

## Project structure

```
core/           # Platform-agnostic Rust library (SSH, keys, SFTP, sync, scenarios)
src-tauri/      # Tauri commands and event bridge
src/            # React frontend
```

## Notes

- Private keys and passwords are encrypted with AES-256-GCM; master key stored in Windows Credential Manager (`brisk-bastion` service)
- Mobile (Tauri Android) can reuse `core/` crate — not implemented in v0.1

## Troubleshooting: Windows build

### Error 4551 — App Control blocked build scripts

If you see `Политика управления приложениями заблокировала этот файл. (os error 4551)`, Windows **Smart App Control** is blocking Cargo build scripts. Fixes:

1. Smart App Control → Off (Settings → Windows Security → App & browser control), reboot
2. Defender exclusions for `target/` and `%USERPROFILE%\.cargo`
3. Developer Mode on
4. Build from a normal PowerShell / Windows Terminal (not a restricted sandbox)

### Error: `NASM command not found` (aws-lc-sys)

`russh` pulls in `aws-lc-rs` / `aws-lc-sys`, which normally requires [NASM](https://www.nasm.us/) on Windows.

This repo sets `AWS_LC_SYS_PREBUILT_NASM=1` in [`.cargo/config.toml`](.cargo/config.toml) so prebuilt NASM objects are used — **no NASM install needed** on x86_64.

If it still fails, either:

```powershell
winget install NASM.NASM
```

Then reopen the terminal and run `cargo build` again.

Or build from **Developer PowerShell for VS 2022** (Start menu → Visual Studio 2022 → Developer PowerShell) so MSVC env vars (`INCLUDE`, `LIB`, `VCINSTALLDIR`) are set:

```powershell
cd D:\Projects\devops-helper
cargo clean
cargo build
```

After any fix:

```bash
cargo clean
cargo build
```

### `ERR_CONNECTION_REFUSED` / «localhost отказано в подключении»

The Tauri window opened, but **Vite is not running** on port `1420`.

| You ran | Fix |
|---------|-----|
| `cargo run` only | Use `npm run tauri dev` instead |
| `npm run tauri dev` failed silently | Run `npm run dev` alone and check for errors |
| Port 1420 busy | Stop the other process or change port in `vite.config.ts` + `tauri.conf.json` |

### `Command create_server_folder not found` (or other `Command … not found`)

The **frontend is new, the Rust binary is old** — e.g. only `npm run dev` in the browser, or `cargo run` without rebuilding after pulling changes.

Fix:

```bash
# stop any running dev / BriskBastion windows, then:
npm run tauri dev
```

If you use two terminals, rebuild before `cargo run`:

```bash
cargo build -p brisk-bastion
cargo run -p brisk-bastion
```

### `crypto error: aead::Error` when connecting

Passwords and SSH private keys are encrypted with a **master key** in Windows Credential Manager (`brisk-bastion`). This error means the stored secret cannot be decrypted — usually the credential was reset or the DB was copied from another machine.

Fix:

1. **Password auth** — right-click server → **Edit…** → enter the password again → Save
2. **Key auth** — Settings → Keys → delete the key → import or generate again → re-select it on the server

If it keeps failing, remove `brisk-bastion` from **Credential Manager → Windows Credentials**, restart the app (a new master key is created), then re-enter all passwords / re-import keys.

Quick check: open [http://localhost:1420](http://localhost:1420) in a browser — you should see the BriskBastion UI before launching Tauri.

## `.bastion` scenario format

One action per line. Lines starting with `#` are comments; the first comment becomes the scenario title.

```
# Deploy my site
local: npm run build
sync: ./dist -> /var/www/my-site
remote: pm2 restart app
```

| Prefix   | What it does                                      |
|----------|---------------------------------------------------|
| `local:` | Runs on your machine (`cmd /C` on Windows)        |
| `remote:`| Runs on the selected SSH server via russh         |
| `sync:`  | Push local path to remote (`local -> remote`)     |

---

## Roadmap

BriskBastion растёт из «удобного SSH-клиента» в **командный центр инфраструктуры**: деплой (`.bastion`) → мониторинг процессов → аудит обновлений и CVE.

Ниже — план по фазам. Идём **по порядку**, каждая фаза — отдельный вертикальный срез (core → Tauri → UI → тест).

### v0.1 — Foundation (текущее)

- [x] SSH terminal (PTY, tabs, host key trust)
- [x] Server list + key vault (ED25519, Windows Credential Manager)
- [x] SFTP browser + rsync-like sync
- [x] `.bastion` scenario runner (`local` / `remote` / `sync`)
- [x] Tauri 2 desktop shell (Windows)

### v0.2 — Monitor: процессы на хосте

**Цель:** вкладка «Monitor» — что крутится на удалённом Linux-сервере, с группировкой и метками доверия.

| ID | Задача | Модуль | Статус |
|----|--------|--------|--------|
| M1 | Сбор процессов через SSH (`ps`, `/proc/*/stat`, cmdline, user, CPU/MEM) | `core/src/monitor/` | [x] |
| M1 | Tauri-команды: `list_processes`, `refresh_processes` | `src-tauri/` | [x] |
| M1 | UI: таблица процессов, авто-refresh, фильтр по имени/user | `src/components/MonitorPanel.tsx` | [x] |
| M2 | SQLite: реестр доверенных бинарников (`sha256`, label, notes) | `core/src/db/` | [x] |
| M2 | Вычисление SHA256 бинарника по SSH (`readlink /proc/PID/exe` + `sha256sum`) | `core/src/monitor/` | [x] |
| M2 | UI: зелёный щит «Trusted publisher», кнопка «Add to registry» | MonitorPanel | [x] |
| M2 | CRUD доверенных записей (локально, не на сервере) | Tauri + UI | [x] |

**Не в scope v0.2:** мониторинг локальной Windows-машины (WMI/sysinfo) — отдельная фаза позже.

### v0.3 — Monitor: Docker

**Цель:** переключатель `[Host] / [Docker]`, дерево «контейнер → процессы внутри».

| ID | Задача | Модуль | Статус |
|----|--------|--------|--------|
| M3 | Парсинг `docker ps --format json`, `docker stats --no-stream` | `core/src/monitor/docker.rs` | [x] |
| M3 | `docker top <container>` → процессы внутри контейнера | `core/src/monitor/docker.rs` | [x] |
| M3 | Обработка «docker not installed / permission denied» с понятной ошибкой | core + UI | [x] |
| M3 | UI: дерево контейнеров, статус, CPU/RAM, expand → processes | MonitorPanel | [x] |
| M4 | *(опционально)* Docker Remote API через unix-socket (`/var/run/docker.sock`) | core | [ ] |
| M4 | *(опционально)* labels, health, compose project name | core + UI | [ ] |

M4 — только если CLI-подхода не хватает; **M3 достаточно для MVP**.

### v0.4 — Updates: diff версий

**Цель:** вкладка «Updates» — что установлено vs что лежит в репах.

| ID | Задача | Модуль | Статус |
|----|--------|--------|--------|
| U1 | Парсер `apt list --upgradable` (Debian/Ubuntu) | `core/src/updates/` | [x] |
| U1 | Парсер `dnf check-update` (RHEL/Fedora) — вторым шагом | `core/src/updates/` | [x] |
| U1 | Авто-детект дистрибутива (`/etc/os-release`) | core | [x] |
| U1 | Tauri: `check_updates(server_id)` → таблица пакетов | `src-tauri/` | [x] |
| U1 | UI: Package \| Installed \| Available \| Size, кнопка Refresh | `UpdatesPanel.tsx` | [x] |

**Принцип:** только отчёт, без автоматического `apt upgrade` в v0.4 (апдейт — через `.bastion` или ручное подтверждение позже).

### v0.5 — Updates: CVE через OSV

**Цель:** подсветка критических уязвимостей для установленных и доступных версий.

| ID | Задача | Модуль | Статус |
|----|--------|--------|--------|
| U2 | HTTP-клиент к [OSV.dev API](https://osv.dev/) (batch queries) | `core/src/updates/osv.rs` | [x] |
| U2 | Маппинг ecosystem: `Debian:12`, `Ubuntu:22.04:LTS` и т.д. | core | [x] |
| U2 | Для каждого пакета: CVE list + severity (CRITICAL/HIGH/…) | core | [x] |
| U2 | Сравнение: текущая версия уязвима? апдейт из репа закрывает CVE? | core | [ ] |
| U3 | SQLite-кэш CVE-ответов (TTL ~24h), offline-friendly | `core/src/db/` | [x] |
| U3 | UI: красные/жёлтые бейджи, tooltip с CVE-ID и описанием | UpdatesPanel | [x] |
| U3 | Фильтр «только security / CRITICAL+HIGH» | UI | [x] |

**Ограничения (з documented):**

- CVE для distro-пакетов ≠ upstream-версия; Ubuntu backports могут не совпасть с OSV 1:1 — показываем «possible match», не 100% guarantee.
- Rate limits OSV — батчинг + кэш обязательны.

### v0.6+ — Backlog (идеи, без сроков)

- [ ] `.bastion`: `sync: remote -> local` (pull)
- [ ] `.bastion`: импорт `.bastion` файла с диска
- [ ] Updates: `ubuntu-security-status`, USN-ссылки
- [ ] Monitor: локальная Windows-машина (sysinfo/WMI)
- [ ] Monitor: Podman / `docker compose ps`
- [ ] Updates: dry-run upgrade preview (`apt-get -s upgrade`)
- [ ] Notifications: «3 critical updates on prod-1» в трее
- [ ] Multi-server dashboard (сводка по всем серверам)

### Планируемая структура кода

```
core/src/
  monitor/          # M1–M4: processes, docker, trusted registry lookup
    mod.rs
    host.rs         # ps, /proc
    docker.rs       # docker CLI / API
    trust.rs        # sha256 ↔ publisher label
  updates/          # U1–U3: package diff, OSV client, cache
    mod.rs
    apt.rs
    dnf.rs
    osv.rs
src/
  components/
    MonitorPanel.tsx
    UpdatesPanel.tsx
```

### Как работать по roadmap

1. Берём **следующую незакрытую фазу** (сейчас: **v0.6+ backlog** или polish U2 «fix available?»).
2. Делаем vertical slice: core → Tauri commands → UI → ручной smoke-test на реальном сервере.
3. Отмечаем `[x]` в этом README в PR / коммите.
4. Не перескакиваем фазы — CVE (U2) без U1 бессмысленен, Docker (M3) без M1 сложнее отлаживать.

### Целевой UX (north star)

```
┌────────────────────────────────────────────────────────────┐
│ Servers │ Terminal │ SFTP │ Scenarios │ Monitor │ Updates │
├────────────────────────────────────────────────────────────┤
│  [Host ▼] [Docker ▼]        CPU ████░░  MEM ██████░░       │
│  ├─ nginx          ✓ Vasya Inc. (trusted)                  │
│  ├─ node app.js                                            │
│  └─ 🐳 web ── PID 1 nginx                                  │
├────────────────────────────────────────────────────────────┤
│  ⚠ 3 security updates: openssh, openssl, libcurl           │
└────────────────────────────────────────────────────────────┘
```

Связка с `.bastion`:

```
# Patch Tuesday
remote: apt-get update
# дальше смотрим CVE во вкладке Updates и решаем, что ставить
```

