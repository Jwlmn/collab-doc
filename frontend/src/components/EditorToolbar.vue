<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useDialog, useMessage } from 'naive-ui'
import { getApiErrorMessage } from '../utils/request'
import { uploadImage } from '../utils/upload'

const props = defineProps<{
  editor: Editor | null
  readonly?: boolean
}>()

const dialog = useDialog()
const message = useMessage()

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

/** 撤销/重做栈可用性（空栈置灰，随事务刷新） */
const canUndo = computed(() => {
  void tick.value
  return props.editor?.can().undo() ?? false
})
const canRedo = computed(() => {
  void tick.value
  return props.editor?.can().redo() ?? false
})

/** 当前段落/标题的对齐值（无属性按默认左对齐算） */
function currentAlign(): string {
  void tick.value
  const fromNode = (name: 'heading' | 'paragraph'): string => {
    const value = props.editor?.getAttributes(name)?.textAlign
    return typeof value === 'string' && value !== '' ? value : 'left'
  }
  return props.editor?.isActive('heading') ? fromNode('heading') : fromNode('paragraph')
}

function toggleAlign(alignment: string): void {
  run((c) => (currentAlign() === alignment ? c.unsetTextAlign() : c.setTextAlign(alignment)))
}

/* ---------------- 文字颜色 ---------------- */

const TEXT_COLORS = ['#1f2329', '#d03050', '#f0883e', '#18a058', '#2080f0', '#9575cd']

const colorMenuOptions = computed(() => [
  { key: 'default', label: '默认颜色' },
  { type: 'divider', key: 'cd' },
  ...TEXT_COLORS.map((c) => ({ key: c, label: 'A', props: { style: `color:${c}` } })),
])

function handleColorMenu(key: string): void {
  if (key === 'default') {
    run((c) => c.unsetColor())
    return
  }
  run((c) => c.setColor(key))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run(command: (chain: any) => any): void {
  if (!props.editor || props.readonly) return
  command(props.editor.chain().focus()).run()
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

/* ---------------- 图片 ---------------- */

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function openImagePicker(): void {
  if (props.readonly || uploading.value) return
  fileInputRef.value?.click()
}

async function handleImagePick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 清空 value：同一文件再次选择时也要触发 change
  input.value = ''
  if (!file || !props.editor) return

  uploading.value = true
  const hide = message.loading('图片上传中…', { duration: 0 })
  try {
    const { url } = await uploadImage(file)
    props.editor.chain().focus().setImage({ src: url, alt: file.name }).run()
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    hide.destroy()
    uploading.value = false
  }
}

function handleTableMenu(key: string) {
  const action = key as TableAction
  if (action === 'insert') {
    run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
    return
  }
  if (action === 'deleteTable') {
    dialog.warning({
      title: '删除表格',
      content: '确定删除当前表格吗？删除后可用 ⌘Z 撤销。',
      positiveText: '删除',
      negativeText: '取消',
      positiveButtonProps: { type: 'error' },
      onPositiveClick: () => run((c) => c.deleteTable()),
    })
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
          aria-label="↶（撤销）"
          :disabled="readonly || !canUndo"
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
          aria-label="↷（重做）"
          :disabled="readonly || !canRedo"
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
          aria-label="加粗 B"
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
          aria-label="斜体 I"
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
          aria-label="~~（删除线）"
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

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="高亮"
          :type="isActive('highlight') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleHighlight())"
        >
          <mark>高亮</mark>
        </n-button>
      </template>
      高亮 (⌘⇧H)
    </n-tooltip>
    <n-dropdown :options="colorMenuOptions" :disabled="readonly" @select="handleColorMenu">
      <n-button size="small" quaternary :disabled="readonly" aria-label="文字色（文字颜色）">
        文字色 ▾
      </n-button>
    </n-dropdown>

    <n-divider vertical />

    <n-tooltip v-for="level in [1, 2, 3]" :key="level" trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="`H${level}（标题 ${level}）`"
          :type="isActive('heading', { level }) ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleHeading({ level: level as 1 | 2 | 3 }))"
        >
          H{{ level }}
        </n-button>
      </template>
      标题 {{ level }}
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="• 列表（无序列表）"
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
          aria-label="1. 列表（有序列表）"
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

    <n-button
      v-for="align in (['left', 'center', 'right'] as const)"
      :key="align"
      size="small"
      quaternary
      :aria-label="align === 'left' ? '左对齐' : align === 'center' ? '居中对齐' : '右对齐'"
      :type="currentAlign() === align ? 'primary' : 'default'"
      :disabled="readonly"
      @click="toggleAlign(align)"
    >
      {{ align === 'left' ? '左' : align === 'center' ? '中' : '右' }}
    </n-button>

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
          aria-label="—（分割线）"
          :disabled="readonly"
          @click="run((c) => c.setHorizontalRule())"
        >
          —
        </n-button>
      </template>
      分割线
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          aria-label="插入图片"
          :disabled="readonly"
          :loading="uploading"
          @click="openImagePicker"
        >
          图片
        </n-button>
      </template>
      插入图片（支持粘贴 / 拖拽）
    </n-tooltip>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      hidden
      aria-hidden="true"
      tabindex="-1"
      @change="handleImagePick"
    />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-dropdown
          :options="tableMenuOptions"
          :disabled="readonly"
          @select="handleTableMenu"
        >
          <n-button size="small" quaternary :disabled="readonly" aria-label="表格">
            表格
          </n-button>
        </n-dropdown>
      </template>
      表格
    </n-tooltip>
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
