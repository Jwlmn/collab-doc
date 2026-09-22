<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  editor: Editor | null
  readonly?: boolean
}>()

/** 事务版本号：驱动 isActive 状态在选区/内容变化时刷新 */
const tick = ref(0)

let tracked: Editor | null = null

watch(
  () => props.editor,
  (editor) => {
    if (tracked) tracked.off('transaction', onTransaction)
    tracked = editor
    if (editor) editor.on('transaction', onTransaction)
  },
  { immediate: true },
)

function onTransaction() {
  tick.value++
}

onBeforeUnmount(() => {
  if (tracked) tracked.off('transaction', onTransaction)
})

function isActive(name: string, attributes?: Record<string, unknown>): boolean {
  void tick.value
  return props.editor?.isActive(name, attributes) ?? false
}

function run(command: (chain: ReturnType<NonNullable<Editor['chain']>>) => unknown): void {
  if (!props.editor || props.readonly) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command(props.editor.chain().focus() as any).run()
}

/** 光标是否在表格内（驱动菜单切换） */
const inTable = ref(false)

watch(
  tick,
  () => {
    inTable.value = props.editor?.isActive('table') ?? false
  },
  { immediate: true },
)
watch(
  () => props.editor,
  () => {
    inTable.value = props.editor?.isActive('table') ?? false
  },
  { immediate: true },
)

type TableAction =
  | 'insert'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'

const tableMenuOptions = computed(() =>
  inTable.value
    ? [
        { key: 'addRowBefore', label: '在上方插入行' },
        { key: 'addRowAfter', label: '在下方插入行' },
        { key: 'addColumnBefore', label: '在左侧插入列' },
        { key: 'addColumnAfter', label: '在右侧插入列' },
        { type: 'divider', key: 'd1' },
        { key: 'deleteRow', label: '删除当前行' },
        { key: 'deleteColumn', label: '删除当前列' },
        { type: 'divider', key: 'd2' },
        { key: 'deleteTable', label: '删除表格', props: { style: 'color: #d03050' } },
      ]
    : [{ key: 'insert', label: '插入表格（3 列 × 3 行）' }],
)

function handleTableMenu(key: string) {
  const action = key as TableAction
  if (action === 'insert') {
    run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
    return
  }
  run((c) => c[action]())
}
</script>

<template>
  <div v-if="editor" class="fmt-toolbar" role="toolbar" aria-label="格式工具栏">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="撤销"
          :disabled="readonly"
          @click="run((c) => c.undo())"
        >
          ↶
        </n-button>
      </template>
      撤销 (⌘Z)
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="重做"
          :disabled="readonly"
          @click="run((c) => c.redo())"
        >
          ↷
        </n-button>
      </template>
      重做 (⇧⌘Z)
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="加粗"
          :type="isActive('bold') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBold())"
        >
          <strong>B</strong>
        </n-button>
      </template>
      加粗 (⌘B)
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="斜体"
          :type="isActive('italic') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleItalic())"
        >
          <em>I</em>
        </n-button>
      </template>
      斜体 (⌘I)
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="删除线"
          :type="isActive('strike') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleStrike())"
        >
          <s>S</s>
        </n-button>
      </template>
      删除线 (⇧⌘S)
    </n-tooltip>

    <n-divider vertical />

    <n-button
      v-for="level in [1, 2, 3]"
      :key="level"
      size="small"
      quaternary
      :aria-label="`标题 ${level}`"
      :type="isActive('heading', { level }) ? 'primary' : 'default'"
      :disabled="readonly"
      @click="run((c) => c.toggleHeading({ level: level as 1 | 2 | 3 }))"
    >
      H{{ level }}
    </n-button>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="无序列表"
          :type="isActive('bulletList') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBulletList())"
        >
          • 列表
        </n-button>
      </template>
      无序列表
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="有序列表"
          :type="isActive('orderedList') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleOrderedList())"
        >
          1. 列表
        </n-button>
      </template>
      有序列表
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="引用"
          :type="isActive('blockquote') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBlockquote())"
        >
          ❝
        </n-button>
      </template>
      引用
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="代码块"
          :type="isActive('codeBlock') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleCodeBlock())"
        >
          {{ '</>' }}
        </n-button>
      </template>
      代码块
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="分割线"
          :disabled="readonly"
          @click="run((c) => c.setHorizontalRule())"
        >
          —
        </n-button>
      </template>
      分割线
    </n-tooltip>

    <n-divider vertical />

    <n-dropdown
      :options="tableMenuOptions"
      :disabled="readonly"
      @select="handleTableMenu"
    >
      <n-button size="small" quaternary :disabled="readonly" aria-label="表格">
        表格
      </n-button>
    </n-dropdown>
  </div>
</template>

<style scoped>
.fmt-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-faint);
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--bg-surface);
  border-radius: 8px 8px 0 0;
}
</style>
