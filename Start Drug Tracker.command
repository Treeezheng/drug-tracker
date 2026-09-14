#!/bin/zsh
# Use the existing local build and database. Never install dependencies here.
set -u
setopt NO_BGNICE

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

pause_terminal() {
  if [[ -t 0 ]]; then
    printf '\n按 Return 结束此启动窗口。'
    read -r
  fi
}

fail() {
  printf '\n%s\n' "$1" >&2
  pause_terminal
  exit 1
}

supports_node_24() {
  [[ -n "$1" && -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1
}

NODE_BIN="$(command -v node 2>/dev/null || true)"
if ! supports_node_24 "$NODE_BIN"; then
  NODE_BIN='/Users/treeem1mbp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
fi
supports_node_24 "$NODE_BIN" || fail '需要 Node.js 24 或更高版本；当前 PATH 和本机备用运行环境均不可用。请查看 README.md。'
export PATH="${NODE_BIN:h}:$PATH"
export PORT=4310
export DOSE_DB_PATH="$SCRIPT_DIR/data/dose-timeline.sqlite"
APP_URL="http://127.0.0.1:$PORT"

# 0 = this application's health signature; 1 = no listener; 2 = another/unhealthy service.
app_status() {
  "$NODE_BIN" --input-type=module - "$APP_URL" <<'NODE'
import net from 'node:net';
const base = process.argv[2];
const port = Number(new URL(base).port);
const reachable = await new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const finish = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(1000, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});
if (!reachable) process.exit(1);
try {
  const response = await fetch(`${base}/api/health`, {
    signal: AbortSignal.timeout(1500), redirect: 'error',
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) process.exit(2);
  const health = await response.json();
  process.exit(health?.ok === true && health.storage === 'local-sqlite' && health.schemaVersion === 2 ? 0 : 2);
} catch {
  process.exit(2);
}
NODE
}

app_status
existing_status=$?
if (( existing_status == 0 )); then
  printf 'Drug Tracker 已在运行：%s\n' "$APP_URL"
  /usr/bin/open "$APP_URL" || printf '请在浏览器中打开上面的地址。\n'
  printf '本窗口没有启动新的服务；原来的服务窗口继续保持运行。\n'
  pause_terminal
  exit 0
elif (( existing_status == 2 )); then
  fail '端口 4310 已有服务，但未通过 Drug Tracker 健康检查。请检查原有窗口；本脚本不会停止其他程序。'
fi

[[ -f "$SCRIPT_DIR/dist/index.html" ]] || fail '尚无已构建页面。请在此项目目录运行 pnpm build，再双击启动。本脚本不会联网安装或自动构建。'
[[ -d "$SCRIPT_DIR/node_modules" ]] || fail '缺少本机依赖目录 node_modules。请查看 README.md 并准备依赖；本脚本不会联网安装。'
[[ -f "$SCRIPT_DIR/server/index.mjs" ]] || fail '找不到 server/index.mjs。请将启动脚本保留在项目根目录。'

server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

printf '正在启动 Drug Tracker…\n'
printf '数据库：%s\n' "$DOSE_DB_PATH"
"$NODE_BIN" server/index.mjs &
server_pid=$!

ready=0
for attempt in {1..40}; do
  kill -0 "$server_pid" 2>/dev/null || break
  if app_status; then
    ready=1
    break
  fi
  /bin/sleep 0.25
done
if (( ready == 0 )); then
  cleanup
  server_pid=''
  fail '启动未通过健康检查。请查看此窗口上方的错误信息；数据库没有被重置。'
fi

printf '\n已打开 %s\n保留此 Terminal 窗口，按 Control-C 停止服务。\n' "$APP_URL"
/usr/bin/open "$APP_URL" || printf '浏览器未能自动打开，请手动访问上面的地址。\n'
wait "$server_pid"
exit_status=$?
server_pid=''
if (( exit_status != 0 )); then
  fail "服务已退出（状态 $exit_status）。请查看此窗口上方的信息。"
fi
printf '\nDrug Tracker 已停止。\n'
pause_terminal
