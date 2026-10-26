<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api, getApiErrorMessage } from '../utils/request'
import ThemeToggle from '../components/ThemeToggle.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const { t } = useI18n()

const accepting = ref(false)

async function handleAccept(): Promise<void> {
  accepting.value = true
  try {
    const token = String(route.params.token)
    const { data } = await api.post(`/invite/${token}`)
    if (data.data.already) {
      message.info(t('invite.alreadyMember'))
    } else {
      message.success(t('invite.joinedReadonly'))
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
    <div class="invite-theme-toggle">
      <ThemeToggle />
    </div>
    <n-card :title="$t('invite.cardTitle')" class="invite-card">
      <n-space vertical size="large" align="center" style="text-align: center">
        <n-text style="font-size: 14px">
          {{ $t('invite.description') }}<br />
          <n-text depth="3">{{ $t('invite.hint') }}</n-text>
        </n-text>
        <n-space>
          <n-button type="primary" :loading="accepting" @click="handleAccept">
            {{ $t('invite.accept') }}
          </n-button>
          <n-button quaternary @click="router.push('/')">{{ $t('invite.backToList') }}</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.invite-page {
  position: relative;
  display: flex;
  justify-content: center;
  /* 上下留白均衡，卡片不贴顶 */
  padding: 72px 16px;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(64, 152, 252, 0.1) 0%, transparent 60%),
    var(--bg-page);
}
.invite-theme-toggle {
  position: absolute;
  top: 16px;
  right: 24px;
}
.invite-card {
  width: min(440px, 92vw);
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-float);
}
</style>
