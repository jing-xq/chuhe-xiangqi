# AGENTS.md — 象棋教学软件

面向零基础新手的纯网页版中国象棋学习软件。无构建步骤、无 npm 依赖，是原生 HTML/CSS/JS 静态站点 + Python/Node 数据工具链的组合。所有文档、注释、UI 文案均为中文，改动时保持中文。

## 运行方式

- **启动（唯一运行入口）**：双击 `启动教学软件.bat`，或 `python tools/serve.py 8000`，浏览器打开 http://127.0.0.1:8000/（建议 Chrome / Edge）。
- **必须通过本地 HTTP 服务器打开**，`file://` 无法加载课程 JSON 与引擎 WASM。
- `tools/serve.py` 必须保持运行：它设置了 COOP/COEP 跨源隔离响应头（引擎多线程 pthread 的 SharedArrayBuffer 依赖此）和 `.wasm` MIME 类型，并对 wasm/NNUE 大文件开启 24h 缓存、其余 `no-store`。
- 引擎不可用的环境自动降级（对弈仅学前档、无提示/分析/分类），改动引擎加载逻辑时注意保留降级路径。

## 技术栈

- **前端**：原生 JavaScript（IIFE 包裹、`"use strict"`、无模块打包器；实际使用 ES2017+ 语法，需现代浏览器），Canvas 棋盘，无框架、无 package.json、无 npm。
- **引擎**：`engine/` 下 fairy-stockfish WASM（多线程 pthread）+ 官方象棋 NNUE 网络 `engine/nnue/xiangqi.nnue`，全部本地加载，离线可用。
- **AI 私教**：可选接 OpenAI 兼容 API（默认 DeepSeek），Key 只存浏览器 localStorage；另有不联网的本地私教 `js/coachbrain.js`（引擎数据 + 规则级棋理知识库翻译）。
- **数据工具链**：Python（课程/谱库转换、校验）+ Node（谱库引擎驱动生成、逻辑测试）。
- **持久化**：学习进度、棋谱、习惯档案、飞刀分类、开局掌握度全部存 localStorage（换浏览器/清缓存即重置）。

## 胜负与评分字段约定（2026-09 稳定性批次统一）

- 对局存档：`winner`（"r"|"b"|"draw"，红黑视角获胜方）+ `mySide`（用户执方）+ `reason`；用户视角胜负一律经 `Games.userResult(rec)` 推导，`result`（"win"|"loss"|"draw"）仅作兼容保留（用户视角）。
- 旧存档迁移：`imported:true` 的旧 `result` 是红方视角（win=红胜），对弈/陪练旧 `result` 是用户视角；`Games.normWinner` 按来源推导，不得无条件翻转。
- 行棋方与评分视角：棋谱 moves 只存 `{m,cn}`，行棋方必须用 `Xiangqi.sideAtPly(startSide, ply)` 按 FEN 推导；走子方分↔红方分转换统一走 `Xiangqi.cpToRed`。
- 引擎调度：所有搜索请求经 `Engine` 内部优先级队列串行（PLAY=100 对局应着 / USER=80 用户提示判分 / REVIEW=60 复盘 / AMBIENT=40 形势条 / BACKGROUND=20 后台批处理），`Engine.setBackgroundPaused(true)` 可暂停后台批处理（Traps.hide 时调用）。新增引擎调用须带优先级。

## 代码组织（js/，全局脚本按依赖顺序在 index.html 中引入）

| 文件 | 全局对象 | 职责 |
|---|---|---|
| `rules.js` | `Xiangqi` | 规则引擎：FEN 解析、走法生成、合法性判断（FEN 首行是黑方底线 rank 9；内部坐标 file a-i / rank 0-9，兼容鹏飞 .pfc 的 h2e2 格式） |
| `notation.js` | — | 中文着法（炮二平五）与坐标互转 |
| `md.js` | — | Markdown 渲染 |
| `sound.js` | — | 音效（`assets/sound/*.wav`） |
| `board.js` | `Board` | Canvas 棋盘绘制与走子交互 |
| `player.js` | `Player` | 讲棋播放器（逐步演示/自动播放/变着/跳转） |
| `quiz.js` | `Quiz` | 练习模式判分 |
| `engine.js` | `Engine` | fairy-stockfish WASM 封装（`init/hint/evalCp/candidates`）；有会话防护：禁 ponder、每次搜索前 stop、会话归属校验 + 超时兜底 |
| `annotated.js` | `Annotated` | 已讲解棋谱存档（取名/评分/六维雷达图） |
| `coachbrain.js` | `CoachBrain` | 本地私教大脑（引擎拆解 + 棋理知识库，零 token） |
| `games.js` | `Games` | 棋谱库 + 复盘分析（逐着评分/形势曲线/问题着） |
| `play.js` | `Play` | 人机对弈（八档职业分段：MultiPV 候选按名次概率选着 + 随机漏着注入控制失误率，未经真人棋力标定） |
| `spar.js` | `Spar` | 私教陪练（引擎对手 + 本地特大实时口述） |
| `guide.js` | `Guide` | 新手入门交互课（12 节） |
| `traps.js` | `Traps` | 飞刀骗招（引擎自动分类：飞刀 vs 骗招） |
| `opening.js` | `Opening` | 开局训练（跟谱/背谱/掌握度模型，状态机 in_book → punish → free → debrief） |
| `coach.js` | `Coach` | AI 私教（API 设置/习惯档案/点评问答） |
| `app.js` | — | 主界面：五类入口导航（今日学习/学课程/做训练/下棋/我的）、课程目录、讲棋/练习双模式、进度分层 |
| `learn.js` | `Learn` | 统一学习记录：课程状态分层（看过/跟做/独立/复习通过）、复习队列（次日/3日/7日）、实战错题、能力标签、今日计划纯函数 `buildPlan` |
| `core.js` | `Core` | 新手路线 30 课运行器（目标/演示/分级提示练习/独立验收）+ 错题复习页；数据来自 `data/core/route.json` |
| `today.js` | `Today` | 今日学习页：确定性规则生成计划（复习→新课→薄弱项→实战），可调板块开关 |
| `backup.js` | `Backup` | 备份导出/导入（版本检查、预览、合并/替换，剥离 API Key）+ 保存失败全局横幅 |

视图约定：各视图模块暴露 `mount(container)/show()/hide()`，切走时 `app.js` 会调用旧视图的 `hide()` 收尾（停定时器等），新视图需遵守。

## 数据

- `data/index.json`：课程索引（9 大分类 A–I，1472 课，`data/lessons/<分类>/<序号>.json`）。
- `data/lessons/`：课程 JSON，格式 `{fen, win, moves:[{m, cn, ch(变着树)}], title, category, plies, vars, annotated}`。
- `data/core/route.json`：新手路线 30 课（6 阶段，115 题），由 `tools/build_route.js` 生成：局面全部由基础 FEN + 着法序列经规则引擎推导校验（accept 可解、有干扰项、提示不泄露坐标——三级提示除外）。
- `data/openings/`：8 个开局体系谱库（主线 20 手 + 变着 + 脱谱教学点），树结构：`moves[].ch[]` 中 `ch[0]` 为主线续着、`ch[1..]` 为变着；节点 `dev[]` 为对方脱谱着（含 `why/punish`）；`mainlineEndPly` 标记入中局点。`index.json` 为索引。
- 引擎坐标对外统一为内部格式（file a-i，rank 0-9）；fairy-stockfish 输出 rank 为 1-10，`engine.js` 的 `toInternal` 负责换算。

## 数据工具链（tools/，重建数据时才需要）

- `build_lessons.py`：从鹏飞象棋 `School.zip` 解析 .pfc 课程生成 `data/lessons/` 与 `data/index.json`。注意其中 ZIP 路径是硬编码的本机路径（`D:\PengfeiChess\...`）。
- `xiangqi.py`：Python 版规则引擎（与 js/rules.js 坐标约定一致，供工具脚本使用）。
- `gen_openings.js`（Node + fairy-stockfish）：开局谱引擎生成器。分工原则：着法全部来自引擎（种子骨架验伤 → MultiPV 首选为主线、次选为变着），讲解文字可人工/LLM 润色但不得改着法。**一致性原则：同一节点的谱着与脱谱着必须出自同一次 MultiPV 搜索**（两次评估抖动会把谱着误判为脱谱）。
- `probe_dev.js`：脱谱教学着增量挖掘探针（只输出报告，不写 data/openings）。
- `build_route.js`（Node）：新手路线生成器，与 `build_openings` 同则：着法/局面由引擎校验，讲解文字可改、着法不可改。
- `build_openings.py`：谱库校验 + 补全 cn/重建 `index.json`；`--check` 只校验不写文件（CI 式快速检查）。
- `apply_comments.py`：评注合并。
- `_eng/`、`_work/`：工具中间产物目录（已 gitignore 相关项见 .gitignore：`.zcode/`、`__pycache__/`、`*.pyc`）。
- `build_failures.log`、`_test_h7.py`：历史调试残留，非正式测试。

## 测试

- **正式测试**：
  - `node tools/test_opening_logic.js` —— `js/opening.js` 的无头逻辑自测（Node 桩环境模拟浏览器），校验用户节点统计、掌握度公式（50·coverage + 30·punishRate + 20·min(games/5,1)，覆盖率分母为 offeredIds）与谱更新修剪。改动 `opening.js` 或 `build_openings.py` 后应跑它。
  - `node tools/test_stability.js` —— 稳定性批次回归（对应规划文档 9.2 十条用例）：入门课 FEN 与任务判定（`Guide._steps`/`Guide._judge`）、胜负字段迁移（`Games.userResult`/`normWinner`）、损分视角（`Games._computeLosses`）、练习定时器取消、引擎调度器串行/优先级/取消/后台暂停、`CoachBrain._replay` 帧一致性。改动 guide/games/quiz/engine/coachbrain 后应跑它。
- `python -B tools/build_openings.py --check` —— 开局谱库校验（CI 式快速检查）。
  - `node tools/test_core_content.js` —— 核心路线内容复验 + Learn 状态分层/复习调度/buildPlan 规则回归。改动 `route.json`、`build_route.js`、`learn.js` 后应跑它。
- 前端其余流程无自动化测试体系；验证靠起服务器在浏览器里走完整流程（跟谱/对弈/分析/私教）。
- 无部署流程——纯静态文件本地运行，`git` 是唯一版本控制。

## 代码风格约定

- 中文注释（文件头块注释说明全局对象 API，如 `/* 引擎封装… Engine.init() -> Promise<bool> */`），保持现有风格。
- 全局对象挂在 `window` 上，IIFE + `"use strict"`，不使用 ES 模块/import。
- localStorage key 统一带版本后缀，如 `xqteach-progress-v1`、`xq-openings-v1`、`xq-annotated-v1`。
- 引擎分（cp）编码：mate 用 ±99000 阈值（见 `coachbrain.js`），评估显示钳制 ±3000。

## 安全与注意事项

- 用户 API Key 只存浏览器 localStorage，绝不写入仓库文件或日志。
- `serve.py` 只监听 `127.0.0.1`，勿改成对外监听。
- 勿把引擎 wasm/NNUE 之外的 `Cache-Control` 改为可缓存（数据文件更新依赖 `no-store`）。
- `build_lessons.py` 的 `School.zip` 路径与任何本机绝对路径不要外泄或当作通用路径。
