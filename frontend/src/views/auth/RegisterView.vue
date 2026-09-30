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
    <n-card :title="$t('auth.registerTitle')" class="auth-card">
      <n-form label-placement="top" @submit.prevent="handleSubmit">
        <n-alert v-if="errorMessage" type="error" class="auth-alert" :show-icon="true">
          {{ errorMessage }}
        </n-alert>
        <n-form-item :label="$t('auth.nameFieldLabel')" required>
          <n-input v-model:value="form.name" name="name" id="name" :aria-label="$t('auth.nameFieldLabel')" :placeholder="$t('auth.nameLabel')" />
        </n-form-item>
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
            :placeholder="$t('auth.passwordShortPlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="$t('auth.passwordConfirmLabel')" required>
          <n-input
            v-model:value="form.password_confirmation"
            name="password_confirmation"
            id="password_confirmation"
            :aria-label="$t('auth.passwordConfirmLabel')"
            type="password"
            show-password-on="click"
            :placeholder="$t('auth.passwordConfirmPlaceholder')"
            @keyup.enter="handleSubmit"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" attr-type="submit">
          {{ $t('auth.submitRegister') }}
        </n-button>
        <div class="auth-switch">
          {{ $t('auth.haveAccount') }}
          <router-link to="/login">{{ $t('auth.toLogin') }}</router-link>
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
  color: var(--text-3);
  font-size: 14px;
}
</style>
