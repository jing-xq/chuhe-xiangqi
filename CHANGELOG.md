# 更新日志

版本号与 `js/constants.js` 的 `XqConst.APP_VERSION` 对齐（顶栏可见）；备份文件格式版本独立演进（`js/backup.js` 的 `FORMAT_VERSION`）。早期迭代记录见 git log。

## [1.1.0] - 2026-10-02

对应《项目优化报告》短期批次（#6~#9）与中期批次可安全落地部分（P1-1 状态机合并、P1-4 产品决策路径）。ES modules 迁移按报告建议继续搁置（等以上稳定后再动）。

### 新增

- **对弈状态机核心 `js/duel-core.js`（P1-1）**：play.js 与 spar.js 此前各持一份复制改写的状态机（LEVELS/BOOK/走子/终局/悔棋/重放/选着），现抽为唯一纯状态机实现，两视图只保留视图层与讲解层；LEVELS 八档难度自此单一出处。
- **对弈流程回归桩 `tools/test_play_flow.js`（#6）**：无头跑通整盘（学前档不依赖引擎），覆盖走子/应着/自然终局/存谱字段约定/悔棋重放/思考中悔棋被拒/重开会话守卫（历史 bug 锁定），22 项断言。
- **引擎自弈标定 `tools/calibrate_levels.js`（P0-2）**：相邻档对打 + 学前vs特大书挡，与 duel-core 同源选着策略（同机浸泡测试），logistic 链推各档 Elo 估计并回填 LEVELS，对手选择器显示「≈Elo」；公共引擎驱动抽 `tools/engdrv.js`（gen_trap_cls 同步改造）。
- **引擎长搜切片（P1-3）**：>900ms 的搜索自动拆 600ms 片（引擎哈希跨片保深度），片间让位给排队的 ≥USER 优先级请求——特大档应着期间按「提示」从最多等 1800ms 降为最多等一片。

### 修复

- **moveIntent 语义修正（P0-1）**：逃子/保子改为按「子」追踪（此前按格子集合差，车从虎口跳进另一个虎口会被误报「逃出受攻」）；捉子加主语校验（新无根子必须是移动子直接捉的，挡线暴露不再误报「捉」）；quietIntent 的补根判定同步排除移动子自身换格。新增 6 个构造局面用例锁定。
- README 补「建议桌面使用」说明（P1-4 的产品决策路径：当前定位家庭电脑，不做手机竖屏适配）。

### 变更

- 顶栏版本号升至 1.1.0；`tools/run_all_tests.bat` 纳入对弈流程桩（6 套测试 + 谱库校验）。

## [1.0.0] - 2026-10-02

首个正式版本号。对应《项目优化报告》快赢批次全部落地。

### 新增

- **诊断层**（`js/diag.js`）：全库 34 处静默空 catch 改为 `Diag.warn/storageFail` 记录；存储写入失败节流弹全局横幅；「我的 → 备份与设置」新增诊断信息折叠块（引擎/语料状态 + 最近警告 + 复制）。
- **数据缓存**（`js/datacache.js`）：静态数据文件会话内同一 URL 只 fetch/解析一次（index.json 双处 fetch、语料/谱库/飞刀 overlay 重复拉取）；备份导入后整页刷新天然生效。
- **飞刀分类唯一实现**（`js/trapcls-core.js`）：`TrapCls.classifyOne(data, searchFn)` 纯函数，运行时 `traps.js` 与离线 `tools/gen_trap_cls.js` 共用，杜绝两份手工副本漂移；新增 8 个桩用例进 `test_stability.js`。
- **入库校验闸门**：`build_lessons.py` 末尾与 `merge_copy.js`（t1/t4）自动跑 `node tools/check_lessons.js`，非法着法/空课即整体失败，坏数据不再可能无声上线。
- **备份提醒**：学习档案超 3MB 弹横幅提醒导出；备份页显示「上次导出备份 N 天前 / 从未备份」。
- **版本可见**：顶栏显示软件版本号；新增本 CHANGELOG。
- **一键回归**：`tools/run_all_tests.bat`（GBK 编码）跑全部无头测试 + 谱库校验。

### 修复

- D226 空课（title="403"、零着法、曾无声上线）从课程索引摘除并删除文件，课程总数 1472 → 1471。
- `check_lessons.js` 将空课从「不视为错误」升级为失败级（退出码 1）。
- 常量去副本：`MATE` / 两套子力价值口径 / 残局阈值统一到 `js/constants.js`（coachbrain.js 与 spar.js 引用同一出处）。
- 清理死代码与残留：`spar.js` 的 `st.tipIdx`/`st.whyIdx`（T1 后无读者）、`tools/_test_h7.py`、`tools/build_failures.log`。
- 浏览器走查发现并修复：`opening.js` 的 `revOf` 在主线末节点 `ch` 为空数组时取出 `undefined` 读 `.m` 抛错（开局训练页谱库加载失败，9-25 起带病）；`Feedback.load` 从未被主动调用导致诊断面板永远显示「加载中」。

