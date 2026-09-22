import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 视口是否处于移动端断点（默认 <768px） */
export function useIsMobile(breakpoint = 768) {
  const isMobile = ref(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  )

  const update = () => {
    isMobile.value = window.innerWidth < breakpoint
  }

  onMounted(() => window.addEventListener('resize', update))
  onBeforeUnmount(() => window.removeEventListener('resize', update))

  return isMobile
}
