<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const accepting = ref(false)

async function handleAccept(): Promise<void> {
  accepting.value = true
  try {
    const token = String(route.params.token)
    const { data } = await api.post(`/invite/${token}`)
    if (data.data.already) {
      message.info('你已经是该文档成员')
    } else {
      message.success('已加入文档（只读），可在共享设置中申请提权')
    }
    await router.replace(`/doc/${data.data.document_id}`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await router.replace('/')
  } finally {
    accepting.value = false
  }
}
</script>

<template>
  <div class="invite-page">
    <n-card title="协作文档邀请" class="invite-card">
      <n-space vertical size="large" align="center" style="text-align: center">
        <n-text style="font-size: 14px">
          有人邀请你加入一篇协作文档<br />
          <n-text depth="3">接受后默认获得只读权限（可阅读、评论）</n-text>
        </n-text>
        <n-space>
          <n-button type="primary" :loading="accepting" @click="handleAccept">
            接受邀请
          </n-button>
          <n-button quaternary @click="router.push('/')">返回文档列表</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.invite-page {
  display: flex;
  justify-content: center;
  padding-top: 96px;
}
.invite-card {
  width: min(440px, 92vw);
}
</style>
