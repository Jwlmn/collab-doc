<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Editor } from '@tiptap/vue-3'
import { useDialog, useMessage } from 'naive-ui'
import { getApiErrorMessage } from '../utils/request'
import { uploadImage } from '../utils/upload'

const { t } = useI18n()

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
  { key: 'default', label: t('toolbar.colorDefault') },
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
        { key: 'addRowBefore', label: t('toolbar.tableAddRowBefore') },
        { key: 'addRowAfter', label: t('toolbar.tableAddRowAfter') },
        { key: 'addColumnBefore', label: t('toolbar.tableAddColBefore') },
        { key: 'addColumnAfter', label: t('toolbar.tableAddColAfter') },
        { type: 'divider', key: 'd1' },
        { key: 'deleteRow', label: t('toolbar.tableDeleteRow') },
        { key: 'deleteColumn', label: t('toolbar.tableDeleteCol') },
        { type: 'divider', key: 'd2' },
        { key: 'deleteTable', label: t('toolbar.tableDelete'), props: { style: 'color: #d03050' } },
      ]
    : [{ key: 'insert', label: t('toolbar.tableInsert') }],
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
  const hide = message.loading(t('toolbar.imageUploading'), { duration: 0 })
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
      title: t('toolbar.deleteTableTitle'),
      content: t('toolbar.deleteTableContent'),
      positiveText: t('toolbar.deleteTableConfirm'),
      negativeText: t('common.cancel'),
      positiveButtonProps: { type: 'error' },
      onPositiveClick: () => run((c) => c.deleteTable()),
    })
    return
  }
  run((c) => c[action]())
}
</script>

<template>
  <div v-if="editor" class="fmt-toolbar" role="toolbar" :aria-label="$t('toolbar.aria')">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.undo')"
          :disabled="readonly || !canUndo"
          @click="run((c) => c.undo())"
        >
          ↶
        </n-button>
      </template>
      {{ $t('toolbar.undoTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.redo')"
          :disabled="readonly || !canRedo"
          @click="run((c) => c.redo())"
        >
          ↷
        </n-button>
      </template>
      {{ $t('toolbar.redoTip') }}
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.bold')"
          :type="isActive('bold') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBold())"
        >
          <strong>B</strong>
        </n-button>
      </template>
      {{ $t('toolbar.boldTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.italic')"
          :type="isActive('italic') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleItalic())"
        >
          <em>I</em>
        </n-button>
      </template>
      {{ $t('toolbar.italicTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.strike')"
          :type="isActive('strike') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleStrike())"
        >
          <s>S</s>
        </n-button>
      </template>
      {{ $t('toolbar.strikeTip') }}
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.highlight')"
          :type="isActive('highlight') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleHighlight())"
        >
          <mark>{{ $t('toolbar.highlight') }}</mark>
        </n-button>
      </template>
      {{ $t('toolbar.highlightTip') }}
    </n-tooltip>
    <n-dropdown :options="colorMenuOptions" :disabled="readonly" @select="handleColorMenu">
      <n-button size="small" quaternary :disabled="readonly" :aria-label="$t('toolbar.colorAria')">
        {{ $t('toolbar.colorBtn') }}
      </n-button>
    </n-dropdown>

    <n-divider vertical />

    <n-tooltip v-for="level in [1, 2, 3]" :key="level" trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="t('toolbar.headingAria', { level })"
          :type="isActive('heading', { level }) ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleHeading({ level: level as 1 | 2 | 3 }))"
        >
          H{{ level }}
        </n-button>
      </template>
      {{ $t('toolbar.headingTip', { level }) }}
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.bulletAria')"
          :type="isActive('bulletList') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBulletList())"
        >
          {{ $t('toolbar.bulletBtn') }}
        </n-button>
      </template>
      {{ $t('toolbar.bulletTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.orderedAria')"
          :type="isActive('orderedList') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleOrderedList())"
        >
          {{ $t('toolbar.orderedBtn') }}
        </n-button>
      </template>
      {{ $t('toolbar.orderedTip') }}
    </n-tooltip>

    <n-divider vertical />

    <n-button
      v-for="align in (['left', 'center', 'right'] as const)"
      :key="align"
      size="small"
      quaternary
      :aria-label="align === 'left' ? $t('toolbar.alignLeftAria') : align === 'center' ? $t('toolbar.alignCenterAria') : $t('toolbar.alignRightAria')"
      :type="currentAlign() === align ? 'primary' : 'default'"
      :disabled="readonly"
      @click="toggleAlign(align)"
    >
      {{ align === 'left' ? $t('toolbar.alignLeft') : align === 'center' ? $t('toolbar.alignCenter') : $t('toolbar.alignRight') }}
    </n-button>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.quoteAria')"
          :type="isActive('blockquote') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleBlockquote())"
        >
          ❝
        </n-button>
      </template>
      {{ $t('toolbar.quoteTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.codeAria')"
          :type="isActive('codeBlock') ? 'primary' : 'default'"
          :disabled="readonly"
          @click="run((c) => c.toggleCodeBlock())"
        >
          {{ '</>' }}
        </n-button>
      </template>
      {{ $t('toolbar.codeTip') }}
    </n-tooltip>
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.hrAria')"
          :disabled="readonly"
          @click="run((c) => c.setHorizontalRule())"
        >
          —
        </n-button>
      </template>
      {{ $t('toolbar.hrTip') }}
    </n-tooltip>

    <n-divider vertical />

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          quaternary
          :aria-label="$t('toolbar.imageAria')"
          :disabled="readonly"
          :loading="uploading"
          @click="openImagePicker"
        >
          {{ $t('toolbar.imageBtn') }}
        </n-button>
      </template>
      {{ $t('toolbar.imageTip') }}
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
          <n-button size="small" quaternary :disabled="readonly" :aria-label="$t('toolbar.tableAria')">
            {{ $t('toolbar.tableBtn') }}
          </n-button>
        </n-dropdown>
      </template>
      {{ $t('toolbar.tableTip') }}
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
