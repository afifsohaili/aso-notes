<script setup lang="ts">
import CheckCircleIcon from '~icons/heroicons/check-circle'
import ExclamationCircleIcon from '~icons/heroicons/exclamation-circle'
import XMarkIcon from '~icons/heroicons/x-mark'

export interface AuthToast {
  message: string
  type: 'error' | 'success'
}

const props = defineProps<{
  toast: AuthToast | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

let dismissTimer: ReturnType<typeof setTimeout> | null = null

function clearDismissTimer() {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
}

function startDismissTimer() {
  clearDismissTimer()
  dismissTimer = setTimeout(emit, 4000, 'close')
}

watch(() => props.toast, (toast) => {
  if (toast)
    startDismissTimer()
  else
    clearDismissTimer()
}, { immediate: true })

onUnmounted(clearDismissTimer)

const icon = computed(() => props.toast?.type === 'success' ? CheckCircleIcon : ExclamationCircleIcon)
const classes = computed(() => {
  if (props.toast?.type === 'success')
    return 'bg-white border-green-200 text-green-800 shadow-green-100'
  return 'bg-white border-red-200 text-red-800 shadow-red-100'
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="toast"
      role="alert"
      class="fixed bottom-6 left-1/2 z-50 w-[calc(100%-3rem)] max-w-sm -translate-x-1/2 rounded-lg border p-4 shadow-lg"
      :class="classes"
    >
      <div class="flex items-start gap-3">
        <component :is="icon" class="mt-0.5 h-5 w-5 shrink-0" />
        <p class="flex-1 text-sm font-medium">
          {{ toast.message }}
        </p>
        <button
          type="button"
          class="shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Close"
          @click="emit('close')"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
    </div>
  </Transition>
</template>
