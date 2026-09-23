<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { getApiErrorMessage } from '../../utils/request'

const router = useRouter()
const auth = useAuthStore()

const form = reactive({
  name: '',
  email: '',
  password: '',
  password_confirmation: '',
})
const loading = ref(false)
const errorMessage = ref('')

async function handleSubmit() {
  loading.value = true
  errorMessage.value = ''
  try {
    await auth.register(form)
    await router.replace('/')
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <n-card title="注册" class="auth-card">
      <n-form label-placement="top" @submit.prevent="handleSubmit">
        <n-alert v-if="errorMessage" type="error" class="auth-alert" :show-icon="true">
          {{ errorMessage }}
        </n-alert>
        <n-form-item label="昵称" required>
          <n-input v-model:value="form.name" name="name" placeholder="你的昵称" />
        </n-form-item>
        <n-form-item label="邮箱" required>
          <n-input v-model:value="form.email" name="email" placeholder="you@example.com" />
        </n-form-item>
        <n-form-item label="密码" required>
          <n-input
            v-model:value="form.password"
            name="password"
            type="password"
            show-password-on="click"
            placeholder="至少 8 位"
          />
        </n-form-item>
        <n-form-item label="确认密码" required>
          <n-input
            v-model:value="form.password_confirmation"
            name="password_confirmation"
            type="password"
            show-password-on="click"
            placeholder="再次输入密码"
            @keyup.enter="handleSubmit"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" attr-type="submit">
          注册
        </n-button>
        <div class="auth-switch">
          已有账号？
          <router-link to="/login">去登录</router-link>
        </div>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  padding-top: 64px;
}
.auth-card {
  width: min(400px, calc(100vw - 32px));
}
.auth-alert {
  margin-bottom: 16px;
}
.auth-switch {
  margin-top: 16px;
  text-align: center;
  color: #888;
  font-size: 14px;
}
</style>
