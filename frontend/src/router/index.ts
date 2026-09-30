import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { i18n } from '../i18n'

const t = i18n.global.t

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      component: () => import('../layouts/DefaultLayout.vue'),
      meta: { guest: true, titleKey: 'router.login' },
      children: [
        {
          // name 须挂在空 path 子路由上：挂父路由会导致按 name 跳转时不渲染子组件（空白页）
          path: '',
          name: 'login',
          component: () => import('../views/auth/LoginView.vue'),
        },
      ],
    },
    {
      path: '/register',
      component: () => import('../layouts/DefaultLayout.vue'),
      meta: { guest: true, titleKey: 'router.register' },
      children: [
        {
          path: '',
          name: 'register',
          component: () => import('../views/auth/RegisterView.vue'),
        },
      ],
    },
    {
      path: '/doc/:id',
      name: 'doc',
      component: () => import('../views/DocEditorView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/sheet/:id',
      name: 'sheet',
      component: () => import('../views/ExcelEditorView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/invite/:token',
      name: 'invite',
      component: () => import('../views/InviteView.vue'),
      meta: { requiresAuth: true, titleKey: 'router.invite' },
    },
    {
      // 公开只读分享：不设 requiresAuth，访客无需登录即可打开
      path: '/share/:token',
      name: 'share',
      component: () => import('../views/ShareView.vue'),
      meta: { titleKey: 'router.share' },
    },
    {
      path: '/',
      component: () => import('../layouts/DefaultLayout.vue'),
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('../views/DocumentsView.vue'),
          meta: { requiresAuth: true, titleKey: 'router.home' },
        },
        {
          path: 'trash',
          name: 'trash',
          component: () => import('../views/TrashView.vue'),
          meta: { requiresAuth: true, titleKey: 'router.trash' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../views/SettingsView.vue'),
          meta: { requiresAuth: true, titleKey: 'router.settings' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { titleKey: 'router.notFound' },
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (!auth.initialized) {
    await auth.fetchUser()
  }

  if (to.meta.requiresAuth && !auth.user) {
    // 用 path 跳转（按 name 解析嵌套路由曾导致登录页空白）
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (to.meta.guest && auth.user) {
    return { name: 'home' }
  }
})

function applyDocumentTitle(to: (typeof router)['currentRoute']['value']): void {
  if (typeof to.meta.titleKey === 'string') {
    document.title = t(to.meta.titleKey)
  } else {
    // doc/sheet 编辑器自行管理标题（加载文档元数据后覆写），这里兜底
    document.title = t('shell.appTitle')
  }
}

router.afterEach(applyDocumentTitle)

// 语言切换后立即刷新标签页标题（afterEach 只在导航时触发）
watch(i18n.global.locale, () => applyDocumentTitle(router.currentRoute.value))
