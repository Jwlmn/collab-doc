# 导入导出功能（Docx / Markdown / Excel）

> 状态：**已完成**（2026-09-22，浏览器级往返验收）
> 范围：方案 A —— 纯前端文件互通；不含原生电子表格编辑器（方案 B 未启动）

## 功能入口

| 操作 | 位置 | 说明 |
|------|------|------|
| **导入** | 文档列表「导入」按钮 | 选择 `.md` / `.markdown` / `.docx` / `.xlsx` → 转换 → 创建新文档 → 跳转编辑器写入内容（文件名作标题） |
| **导出** | 编辑器顶栏「导出 ▾」 | Markdown（.md）/ Word（.docx）/ Excel（.xlsx，仅含表格时；无表格给出提示） |
| **表格** | 编辑器工具栏「表格」 | 表格外：插入 3×3（含表头）；表格内：上下插行、左右插列、删行/删列/删表格 |

## 技术实现（`frontend/src/io/`）

- **`extensions.ts`** — `getBaseExtensions()`：StarterKit(+Link) + TableKit，是编辑器与导入转换共用的 **schema 唯一来源**
- **`markdown.ts`** — 自研双向转换：
  - 序列化：标题/段落/行内样式（粗斜删码链接）/嵌套列表/引用/围栏代码/GFM 表格/分割线/元字符转义
  - 解析：行扫描 + 行内 tokenizer；`***嵌套***` 三连星闭合右移消歧；表格分隔行按单元格逐段校验
- **`docx-export.ts`** — `docx` 库；标题级别、编号列表 numbering、代码底纹、超链接、表格表头底纹
- **`docx-import.ts`** — `mammoth`（浏览器版 `mammoth.browser.min.js`，需手写类型声明）→ HTML → `generateJSON(html, getBaseExtensions())`
- **`xlsx-export.ts` / `xlsx-import.ts`** — `write-excel-file`（多 sheet：每个表格一个工作表，表头加粗底纹，纯数字转数值单元格）/ `read-excel-file` **v9 默认导出返回 `Sheet[]`（`{sheet, data}`），行数据在 `data`**
- **`tables.ts`** — table 节点提取、单元格文本化（补列对齐）、文本↔数值判定
- **种子写入** — `stores/importFlow.ts`：列表页转换成功 → 创建空文档 → `setPending(json)` → 编辑器协同 **首次 synced 后** `setContent`（provider 的 EventEmitter **没有 `once`**，需 `on` + `off` 手写一次性）

## 已知边界（有损项）

- docx 复杂排版（浮动图片、分栏、样式级联）不保留；mammoth 只保基础语义
- xlsx 合并单元格、公式（读缓存值）、列宽样式不保留；多工作表仅导入第一个
- 导出的 xlsx 仅包含文档中的表格节点

## 验收记录（真实浏览器）

- MD 导入：h1/粗体/链接/有序列表全量写入编辑器 ✅
- XLSX 字节级往返：`buildTablesXlsxBlob` → File → 导入 → 表格 `[["名称","数量"],["苹果","42"]]` 精确还原 ✅
- DOCX 字节级往返：H2/加粗/无序列表全部还原 ✅
- 三导出 toast 全部成功、表格内菜单 7 项行列操作 ✅
- 回归：前端 39 单测 + vue-tsc + build、后端 75 测试 + pint、server tsc 全绿

## 踩坑备忘

1. HocusPocus provider `EventEmitter` 只有 `on/emit/off` —— 没有 `once`（导入静默丢失的根因）
2. `read-excel-file` v9 default 返回 `Sheet[]` 而非 `Row[]`（`row.some is not a function`）
3. `@tiptap/suggestion` 默认 `allowedPrefixes=[' ']`（中文斜杠命令需 `null`）
4. mammoth 无 TS 类型且 browser 字段不完整 —— 用 `mammoth/mammoth.browser.min.js` + ambient declaration
