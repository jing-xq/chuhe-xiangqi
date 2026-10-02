# 更新日志

版本号与 `js/constants.js` 的 `XqConst.APP_VERSION` 对齐（顶栏可见）；备份文件格式版本独立演进（`js/backup.js` 的 `FORMAT_VERSION`）。早期迭代记录见 git log。

## [1.0.0] - 2026-10-02

首个正式版本号。对应《项目优化报告》快赢批次全部落地。

### 新增

- **诊断层**（`js/diag.js`）：全库 34 处静默空 catch 改为 `Diag.warn/storageFail` 记录；存储写入失败节流弹全局横幅；「我的 → 备份与设置」新增诊断信息折叠块（引擎/语料状态 + 最近警告 + 复制）。
- **数据缓存**（`js/datacache.js`）：静态数据文件会话内同一 URL 只 fetch/解析一次（index.json 双处 fetch、语料/谱库/飞刀 overlay 重复拉取）；备份导入后整页刷新天然生效。
- **飞刀分类唯一实现**（`js/trapcls-core.js`）：`TrapCls.classifyOne(data, searchFn)` 纯函数，运行时 `traps.js` 与离线 `tools/gen_trap_cls.js` 共用，杜绝两份手工副本漂移；新增 8 个桩用例进 `test_stability.js`。
- **入库校验闸门**：`build_lessons.py` 末尾与 `merge_copy.js`（t1/t4）自动跑 `node tools/check_lessons.js`，非法着法/空课即整体失败，坏数据不再可能无声上线。
- **备份提醒**：学习档案超 3MB 弹横幅提醒导出；备份页显示「上次导出备份 N 天前 / 从未备份」。
- **版本可见**：顶栏显示软件版本号；新增本 CHANGELOG。
- **一键回归**：`tools/run_all_tests.bat`（GBK 编码）跑全部 5 套无头测试 + 谱库校验。

### 修复

- D226 空课（title="403"、零着法、曾无声上线）从课程索引摘除并删除文件，课程总数 1472 → 1471。
- `check_lessons.js` 将空课从「不视为错误」升级为失败级（退出码 1）。
- 常量去副本：`MATE` / 两套子力价值口径 / 残局阈值统一到 `js/constants.js`（coachbrain.js 与 spar.js 引用同一出处）。
- 清理死代码与残留：`spar.js` 的 `st.tipIdx`/`st.whyIdx`（T1 后无读者）、`tools/_test_h7.py`、`tools/build_failures.log`。
