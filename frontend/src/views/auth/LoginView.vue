<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { getApiErrorMessage } from '../../utils/request'
import AuthShell from '../../components/AuthShell.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const form = reactive({ email: '', password: '', remember: false })
const loading = ref(false)
const errorMessage = ref('')

async function handleSubmit() {
  loading.value = true
  errorMessage.value = ''
  try {
    await auth.login(form)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (error) {
    errorMessage.value = getApiErrorMessage(error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell :title="$t('auth.loginTitle')">
    <template #subtitle>{{ $t('auth.subtitleLogin') }}</template>
    <n-form label-placement="top" @submit.prevent="handleSubmit">
      <n-alert v-if="errorMessage" type="error" class="auth-alert" :show-icon="true">
        {{ errorMessage }}
      </n-alert>
      <n-form-item :label="$t('auth.emailLabel')" required>
        <n-input v-model:value="form.email" name="email" id="email" :aria-label="$t('auth.emailLabel')" :placeholder="$t('auth.emailPlaceholder')" />
      </n-form-item>
      <n-form-item :label="$t('auth.passwordLabel')" required>
        <n-input
          v-model:value="form.password"
          name="password"
          id="password"
          :aria-label="$t('auth.passwordLabel')"
          type="password"
          show-password-on="click"
          :placeholder="$t('auth.passwordPlaceholder')"
          @keyup.enter="handleSubmit"
        />
      </n-form-item>
      <n-form-item>
        <n-checkbox v-model:checked="form.remember" name="remember">{{ $t('auth.rememberMe') }}</n-checkbox>
      </n-form-item>
      <n-button type="primary" block size="large" :loading="loading" attr-type="submit">
        {{ $t('auth.submitLogin') }}
      </n-button>
      <div class="auth-switch">
        {{ $t('auth.noAccount') }}
        <router-link to="/register">{{ $t('auth.toRegister') }}</router-link>
      </div>
    </n-form>
  </AuthShell>
</template>

<style scoped>
.auth-alert {
  margin-bottom: 16px;
}
.auth-switch {
  margin-top: 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
}
</style>
