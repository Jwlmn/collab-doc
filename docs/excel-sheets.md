# 双文档类型：MD 富文本 × Excel 电子表格

> 状态：**已完成**（2026-09-22，双标签实时协同浏览器验收）
> 定位：Excel 是**独立文档类型**（专用网格编辑器 + 实时协同 + 独立导入导出），不是富文本文档内嵌表格

## 类型体系

| | MD 文档 | Excel 表格 |
|---|---|---|
| `documents.type` | `md`（默认，存量回填） | `excel` |
| 路由 | `/doc/:id` | `/sheet/:id`（互为防呆重定向） |
| 编辑器 | Tiptap 富文本（`DocEditorView`） | Y.js 网格（`ExcelEditorView`，A-Z 列 × 自动行） |
| 协同 | Y.XmlFragment('default') | **Y.Map('cells')**，key=`"行,列"` |
| 导入 | `.md` / `.docx` | `.xlsx`（仅此格式） |
| 导出 | `.md` / `.docx` | `.xlsx`（**MD 的导出菜单已移除 xlsx**） |
| 版本历史 | ✅ | 隐藏（Tiptap 快照不适用） |
| 评论/共享/同步/权限 | ✅ | ✅（同一套 API/策略/协作令牌） |
| 全文搜索 | 标题+正文 | 仅标题（单元格不进 search_text） |

## 入口

- 列表「新建 ▾」下拉：**📄 MD 文档 / 📊 Excel 表格**；空态双 CTA
- 列表项：类型标签（`MD` 灰 / `Excel` 绿）+ 按类型换图标，打开按 type 分流
- 导入按扩展名分流：md/docx→md 文档，xlsx→excel 文档（`importFlow` 种子载荷带 kind）

## Excel 编辑器交互

- 单击选中 · 双击 / F2 / 直接键入编辑 · 方向键与 Tab 导航 · Enter 提交并下移 · Esc 取消
- 直接键入 = **覆盖编辑**（光标置末尾继续追加，不做全选——全选会吞字符）
- 网格默认 16×30，随数据边界自动扩展；空值提交即删 key（稀疏存储）
- 顶栏：类型 tag / 标题改名（owner）/ 共享 / 导出 xlsx / 评论（未读徽标）/ 协作者头像 / 同步状态

## 数据层

- 迁移 `add_type_to_documents_table`：`type` default `'md'` + `(type, updated_at)` 索引
- `POST /api/documents` 校验 `type ∈ {md, excel}`（`Document::types()`）
- `DocumentResource` 返回 `type`；协作服务器对 excel 文档抽取正文为空（自动只搜标题）

## 验收记录（真实浏览器）

- 双入口创建：Excel 文档建出并带 `Excel` 标签 ✅
- 网格编辑：点击选中 → 键入覆盖（draft 追加不丢字符）→ Enter 提交 → 渲染 + 持久化（state 里 `cells` map）✅
- **双标签实时协同**：标签4 编辑 → 标签2 即时出现；新标签加载完整恢复 ✅
- 导出 xlsx toast 成功 ✅
- 防呆：`/doc/11`（excel）自动重定向 `/sheet/11` ✅
- xlsx 导入：`库存表.xlsx` → `/sheet/12` 网格值全还原 ✅
- 回归：前端 45 单测 + 后端 77 测试 + 三端 tsc/build/pint 全绿

## 踩坑备忘

1. **input focus 选择器**：`nextFocus` 曾写成 `.cell-editor input`（input 无子元素）→ 永不聚焦，应为 `input.cell-editor`
2. **`select()` 吞字符**：覆盖编辑初始化若全选，快速连续键入的首字符会被下一键替换 → 直接键入路径改光标置末尾
3. **CDP `type_text` 走 insertText 不发 keydown**：自动化测试用 `press_key` 单键模拟真实键盘；真实用户不受影响
4. 第一版 Excel 入口曾误跳列表：dropdown 点击 uid 过期所致（HMR），功能本身正常

## 已知边界（第一版）

- 不支持插删行列 / 公式 / 单元格样式（Y.Map 坐标模型下结构变更是后续课题）
- awareness 单元格级光标未做（顶栏有协作者头像）
- Excel 文档无版本历史入口

---

# v2「表格引擎」（2026-09-22 完成）

在 v1 基础上补齐电子表格核心能力，全部经浏览器验收。

## 数据模型重构（v1 → v2）

- **v1**：`ydoc.getMap('cells')`，key=`"行,列"` → 文本
- **v2**：`ydoc.getArray('rows')`，每行一个 `Y.Map<col, CellValue>`
  - `CellValue = string | { v, b?, c?, bg?, al? }`（平面对象携带样式）
  - **行插删走 Y.Array 原语 → 协同安全**；列操作 = 逐行 key 重排（低频，多人并发列操作为最后写赢）
- **旧文档自动迁移**：加载同步后若 rows 为空且存在 legacy cells → 一次性迁移并清空旧数据（避免多端同时首次打开同一旧文档）
- 实现：`src/io/sheet-model.ts`（SheetModel 类：读写/样式/插删/深度 observe/toGrid/replaceGrid/fillFromCells）

## 新增能力

| 能力 | 说明 |
|------|------|
| **行列插删** | 格式栏「行 ▾ / 列 ▾」：上/下插行、左/右插列、删除当前行/列；最后一行删除转为清空 |
| **多格选区** | 拖拽框选、Shift+点击扩展、方向键+Shift 扩展；选区统计显示在格式栏 |
| **单元格样式** | 加粗（toggle）、文字色/背景色（色板下拉，背景可清除）、左/中/右对齐；样式随选区批量应用，随 xlsx 导出 |
| **公式引擎** | `src/io/formula.ts`：四则/括号/单元格引用（`A1`/`$A$1`）/区间 `A1:B2`、函数 SUM/AVG/MIN/MAX/COUNT、公式链递归、**栈式防环**（兄弟引用 `=A1/A1` 合法，真环 `#CYCLE!`，语法/除零 `#ERROR!`）；显示结果、编辑显示原文；Excel 语义：区间内非数字不参与聚合 |
| **协同光标** | awareness 播报 `{user, cell}`，对端焦点格显示彩色名字角标（`[data-remote-name]::after`） |
| **Excel 版本历史** | 顶栏「版本」：快照存 `{grid: SheetCell[][]}` + HTML 预览；恢复 = `replaceGrid` 整体替换并协同广播 |

## 导出升级

- `exportGridToXlsx`：公式导出**计算结果**、样式（加粗/背景/文字色/对齐）随单元格导出

## 验收记录（浏览器）

- v1→v2 迁移：旧数据 Q/XY 完整保留，30×16 → 插行31行（数据正确下移）、插列右移 ✓
- 公式 `=1+2` 输入→提交→显示 `3` ✓；单元格样式 fontWeight 700 + 背景色生效 ✓
- 双标签：协同光标角标互显（李四）✓
- 导出 toast 成功（含样式/公式结果管道）✓
- 版本：保存 → 破坏数据（写 Z）→ 恢复 → **Z 回滚、数据完整、抽屉关闭、零报错** ✓
- 回归：前端 70 单测（sheet-model 12 + formula 18）/ 后端 77 / 三端 tsc/build/pint 全绿

## v2 踩坑备忘

1. **td 的 mousedown.prevent 阻断了默认焦点链** — 点击单元格后网格容器不再获得焦点，键盘全部失效；需在处理器里手动 `closest('.grid-wrap').focus()`
2. **公式防环的 `seen` 必须是递归栈（入栈/出栈）** 而非历史访问集 — 否则 `=A1/A1` 兄弟引用被误判为循环；哨兵传播用专用 `CycleError` 避免被通用 catch 吞成 `#ERROR!`
3. **聚合函数区间取值要宽松转数**（非数字→null 忽略，Excel 语义），表达式内引用文本格才报错
4. **协同环境 getStyle/getRaw 必须防御非法值**（平面对象检查 `v in value`），中间态解构崩溃曾导致渲染 promise 链断裂
5. 大文件 Write 输出曾损坏 style 段（乱码）— 拆段重建 + tsc 兜底
6. `seen` 栈语义、Excel 语义等核心逻辑全部有 Vitest 覆盖（70 单测）

## v2 已知边界

- 列级并发插删 = 最后写赢（低频操作建议错峰）
- 无单元格合并、行高列宽调整、条件格式
- 公式函数集为最小集（无 IF/VLOOKUP 等，可按需扩展 tokenizer/函数表）
