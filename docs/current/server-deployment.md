# 服务器部署与运维手册

> 部署日期：2026-10-17。生产地址：`http://106.55.32.77/`（暂无域名与 HTTPS）。

## 一、服务器与环境

| 项 | 值 |
| --- | --- |
| 云厂商 | 腾讯云轻量应用服务器（OpenCloudOS-RITH，广州四区） |
| IP | `106.55.32.77`（公网） |
| 配置 | 4 核 / 4G 内存 / 40G SSD / 300G 月流量 |
| 系统 | OpenCloudOS 9.6（RHEL 系，`dnf` 包管理） |
| 运行时 | Node `v20.20.2`、bun `1.4.3`（`/usr/bin/bun`）、PostgreSQL `16.15`、nginx `1.29.8` |
| Redis | **未安装**（单实例部署，presence 订阅在 `server.ts` listen 后统一挂载，无 Redis 也可正常投递刷新帧） |

## 二、架构

```
浏览器 ── http://106.55.32.77/ (80)
            │
          nginx ──┬─ /          → 127.0.0.1:3000  Next standalone（node server.js）
                  └─ /game-ws/  → 127.0.0.1:3201  game-server（Colyseus，strip 前缀）
                                                    ├─ matchmake HTTP POST
                                                    └─ WebSocket upgrade (/{processId}/{roomId})
PostgreSQL 16 ── 127.0.0.1:5432 / immortality 库（scram-sha-256 密码认证）
Next → game-server 推帧 ── POST http://127.0.0.1:3201/internal/state-refresh
                            （header: x-internal-realtime-token）
```

关键设计：

- 客户端构建时注入 `NEXT_PUBLIC_GAME_SERVER_WS_URL=/game-ws`，SDK 以 `ws://<host>/game-ws` 为
  endpoint；game-server **不设置** `GAME_SERVER_PUBLIC_ADDRESS`，matchmake 响应不带
  `publicAddress`，SDK 始终走 nginx 同端口反代——**只需防火墙放行 80 一个端口**。
- 跨进程推帧走内网 `GAME_SERVER_INTERNAL_URL=http://127.0.0.1:3201` + 内部 token，不暴露公网。

## 三、路径与凭据

| 路径 | 内容 |
| --- | --- |
| `/opt/immortality` | 项目源码与构建产物 |
| `/opt/immortality/.env.local` | 环境变量（`DATABASE_URL`、`NEXT_PUBLIC_GAME_SERVER_WS_URL`、`GAME_SERVER_INTERNAL_URL`、`GAME_SERVER_INTERNAL_TOKEN`），权限 600 |
| `/root/.dbpw` | 数据库密码（`immortality` 用户） |
| `/root/.internal_token` | 内部推帧 token |
| `/root/deploy/` | 部署脚本与 systemd/nginx 配置副本 |
| `/var/lib/pgsql/data/pg_hba.conf` | 认证配置（`local postgres=peer`，其余 `scram-sha-256`） |

## 四、服务管理

```bash
systemctl status immortality-web      # Next（3000）
systemctl status immortality-game     # Colyseus game-server（3201）
systemctl status nginx postgresql
journalctl -u immortality-game -n 50 --no-pager   # 查日志
systemctl restart immortality-web immortality-game
```

两个服务均 `Restart=always`，`After=postgresql.service`，开机自启。

## 五、健康检查

```bash
curl -s http://127.0.0.1:3201/health          # game-server（6 类房间）
curl -s http://127.0.0.1/game-ws/health       # 经 nginx
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/login   # 200
```

## 六、更新部署流程

```bash
# 本地：打包（排除依赖与产物）
tar -czf immortality-src.tar.gz \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude=.bak \
  --exclude=".next_prev_*" --exclude=.codebuddy -C d:/Immortality-main .

# 上传后服务器执行：
cd /opt/immortality && tar -xzf /root/immortality-src.tar.gz
cd /opt/immortality && bun install --ignore-scripts   # registry 已配 npmmirror
# schema 有变更时：bunx drizzle-kit push --force（本项目迁移历史不含部分表，勿用 db:migrate）
NEXT_PUBLIC_GAME_SERVER_WS_URL=/game-ws bun run build
systemctl restart immortality-web immortality-game
# 冒烟（与生产并存，换端口）：
GAME_SERVER_PORT=3401 bun run --cwd apps/game-server smoke
```

## 七、初始化记录与注意事项

1. **建表用 `drizzle-kit push` 而非 `db:migrate`**：`sects`、`fortunes` 等表在迁移历史中
   只有 alter 没有 create（历史遗留），空库跑 `db:migrate` 会在 0069 失败。
   `push --force` 直接按 `src/db/schema.ts`（101 张表）对齐空库。
2. 世界包：`FOUR_REALMS_APPLY=1 bun run worldpack:four-realms:apply`（需显式开关）。
3. seed：`db:seed:starter-fortunes`（19+1 条）、`db:seed:buff-skills`（20 条）均已执行。
4. `better-sqlite3` 原生二进制未编译（`--ignore-scripts` 安装）；`src` 中无直接引用，
   若未来某路径运行时报缺失，进入其包目录执行 `bunx node-gyp rebuild`。
5. worldpack 输出 `seededAlchemyRecipes: false` / `seededSmithingRecipes: false`，
   炼丹/炼器配方当前可能为空，首验时注意这两页是否空列表。
6. smoke 修正：`smoke.ts` 附近频道断言已更新为 `nearby_chat_echo` 回声契约（含反向断言）。

## 七点五、登录与建角故障修复记录（2026-10-17）

现象「登录不上」实为三道串行阻塞，均已从代码根治：

1. **会话 cookie 带 `Secure`，HTTP 站点被浏览器丢弃**
   原判定 `NODE_ENV === "production"` 即加 `Secure`。生产跑在 HTTP 上，浏览器依法不保存
   Secure cookie，登录成功瞬间即掉线。改为 `resolveCookieSecureFlag()`
   （`src/modules/shared/services/cookie-security.ts`），优先级：
   `SESSION_COOKIE_SECURE` 环境变量 → 请求头 `x-forwarded-proto` → `NODE_ENV`。
   上 HTTPS 后会自动恢复 `Secure`，无需改代码。
2. **建角预览依赖 LLM，未配置则 500**
   `generateSpiritualRoot()` 直接调模型且无兜底，缺 `LLM_BASE_URL` 时抛错导致建不了角色。
   现整条链路纳入兜底：未配置 / 调用失败 / 返回无法解析，一律退回
   `buildOfflineSpiritualRoot(wish)`——按心愿文本做 FNV-1a 确定性哈希生成五行灵根
   （同一句心愿必得同一灵根），约三成概率带常规属性变异（雷/冰/风/暗/光）。
   配了模型后自动优先走 AI，失败仍会兜底。
3. **建角插入漏列 `last_seen_at`**
   插入走兼容层 `insertPlayerCompat()`，其 `buildPlayerInsertEntries()` 未包含该列，
   而 `players.last_seen_at` 是 NOT NULL 且无数据库默认值 → 插入被拒（`创建角色失败`）。
   已补 `["last_seen_at", input.lastSeenAt ?? nowIso]`。

附：头像表 `avatar_assets` 当前为空（管理后台上传，非阻塞，`avatarId` 在建角接口里是可选字段）。

### 接入真实 LLM（可选）

三键写入 `system_configs` 表即可（`key` / `value` 两列，任何 OpenAI 兼容服务）：

| key | 说明 |
| --- | --- |
| `LLM_BASE_URL` | 例如 `https://api.deepseek.com/v1` |
| `LLM_API_KEY` | 密钥 |
| `LLM_MODEL` | 例如 `deepseek-chat` |

灵根可单独覆盖：`SPIRITUAL_ROOT_LLM_BASE_URL` / `_API_KEY` / `_MODEL`。
未配置时建角照常可用（走本地模板）。

## 八、待办与安全提醒

- **立即修改服务器密码或改用 SSH 密钥**（部署过程中密码曾明文传输）。
- 云控制台防火墙当前放行 80/22；如启用 HTTPS 需域名 + 证书（Colyseus 客户端会自动
  随页面协议切 `wss`，nginx 需相应加 TLS 与 upgrade 头）。
- 4G 内存机器上 `next build` 峰值约 1.4G，与生产进程并存可行，但更新时建议
  先 `systemctl stop immortality-web` 再构建。
- `.env.local` 含生产凭据，更新部署的 tar 不要把它打进包里再传回（当前流程会覆盖它，
  建议更新前 `cp .env.local /root/.env.local.bak`）。
