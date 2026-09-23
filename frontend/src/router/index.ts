import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const PAGE_TITLE = '多人实时协作文档'

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      component: () => import('../layouts/DefaultLayout.vue'),
      meta: { guest: true, title: `登录 · ${PAGE_TITLE}` },
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
      meta: { guest: true, title: `注册 · ${PAGE_TITLE}` },
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
      meta: { requiresAuth: true, title: `接受邀请 · ${PAGE_TITLE}` },
    },
    {
      path: '/',
      component: () => import('../layouts/DefaultLayout.vue'),
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('../views/DocumentsView.vue'),
          meta: { requiresAuth: true, title: PAGE_TITLE },
        },
        {
          path: 'trash',
          name: 'trash',
          component: () => import('../views/TrashView.vue'),
          meta: { requiresAuth: true, title: `回收站 · ${PAGE_TITLE}` },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { title: `页面不存在 · ${PAGE_TITLE}` },
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

router.afterEach((to) => {
  if (typeof to.meta.title === 'string') {
    document.title = to.meta.title
  } else if (to.name === 'doc') {
    // 编辑器自行管理标题（加载文档元数据后覆写）
    document.title = PAGE_TITLE
  } else {
    document.title = PAGE_TITLE
  }
})
