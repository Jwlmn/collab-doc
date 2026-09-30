<script setup lang="ts">
import { computed } from 'vue'
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  zhCN,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { lightThemeOverrides, darkThemeOverrides } from './styles/theme'
import { useTheme } from './composables/useTheme'

const { isDark } = useTheme()
const { locale } = useI18n()

// naive-ui 组件内置文案（分页/日期选择等）随应用语言切换
const naiveLocale = computed(() => (locale.value === 'en' ? enUS : zhCN))
const naiveDateLocale = computed(() => (locale.value === 'en' ? dateEnUS : dateZhCN))
</script>

<template>
  <n-config-provider
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme="isDark ? darkTheme : undefined"
    :theme-overrides="isDark ? darkThemeOverrides : lightThemeOverrides"
  >
    <n-notification-provider>
      <n-message-provider>
        <n-dialog-provider>
          <router-view v-slot="{ Component }">
            <transition name="page-fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </n-dialog-provider>
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>
