<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDocumentsStore } from '../stores/documents'
import { useFoldersStore } from '../stores/folders'
import type { DocumentMeta } from '../types'

/**
 * 编辑器左栏文件树：文件夹分组 + 未分类，点击直接切换文档。
 *
 * 数据来自 documents/folders store（与列表页同一份缓存语义，挂载即拉取）。
 * 文档切换会改路由参数，App.vue 的 router-view 按 id 加 key 强制重挂载
 * 编辑器视图（协作连接按文档建，不能原地复用实例）。
 */
const props = defineProps<{ currentId?: number }>()

const documents = useDocumentsStore()
const folders = useFoldersStore()
const router = useRouter()
const { t } = useI18n()

onMounted(async () => {
  await Promise.all([
    documents.fetch().catch(() => {}),
    folders.fetch().catch(() => {}),
  ])
})

interface TreeGroup {
  key: string
  label: string
  docs: DocumentMeta[]
}

const groups = computed<TreeGroup[]>(() => {
  const result: TreeGroup[] = folders.list.map((folder) => ({
    key: `f${folder.id}`,
    label: folder.name,
    docs: documents.list.filter((doc) => doc.folder_id === folder.id),
  }))
  const unfiled = documents.list.filter((doc) => !doc.folder_id)
  // 未分类组恒在（新用户/移空文件夹后仍有一个可见落点），空时给提示
  result.push({ key: 'unfiled', label: t('folders.unfiled'), docs: unfiled })
  return result
})

function openDoc(doc: DocumentMeta): void {
  if (doc.id === props.currentId) return
  void router.push(doc.type === 'excel' ? `/sheet/${doc.id}` : `/doc/${doc.id}`)
}
</script>

<template>
  <div class="doc-tree">
    <div class="tree-header">
      <span class="tree-title">{{ $t('editor.treeTitle') }}</span>
      <n-text depth="3" class="tree-count">{{ $t('documents.totalDocs', { count: documents.list.length }) }}</n-text>
    </div>

    <n-spin :show="documents.loading" class="tree-scroll">
      <n-empty
        v-if="!documents.loading && documents.list.length === 0"
        :description="$t('editor.treeEmpty')"
        size="small"
        style="padding-top: 32px"
      />
      <div v-else class="tree-groups">
        <div v-for="group in groups" :key="group.key" class="tree-group">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="doc in group.docs"
            :key="doc.id"
            type="button"
            class="tree-item"
            :class="{ active: doc.id === props.currentId }"
            :aria-current="doc.id === props.currentId ? 'page' : undefined"
            @click="openDoc(doc)"
          >
            <span class="item-icon" aria-hidden="true">{{ doc.type === 'excel' ? '📊' : '📄' }}</span>
            <span class="item-title">{{ doc.title }}</span>
            <span v-if="doc.pinned" class="item-pin" aria-hidden="true">📌</span>
          </button>
          <div v-if="group.docs.length === 0" class="group-empty">{{ $t('folders.filterEmpty') }}</div>
        </div>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.doc-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.tree-header {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 8px;
}
.tree-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-1);
}
.tree-count {
  font-size: 12px;
}
.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px;
}
.tree-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.group-label {
  padding: 0 8px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: none;
}
.tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-1);
  text-align: left;
}
.tree-item:hover {
  background: var(--bg-hover);
}
.tree-item.active {
  background: var(--bg-active);
  font-weight: 600;
}
.item-icon {
  flex: none;
  font-size: 14px;
}
.item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-pin {
  flex: none;
  font-size: 11px;
}
.group-empty {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
