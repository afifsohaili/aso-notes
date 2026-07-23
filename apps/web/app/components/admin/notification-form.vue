<script setup lang="ts">
interface FormData {
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error'
  target_type: 'workspace' | 'role'
  target_id: string
  is_active: boolean
}

interface NotificationFormProps {
  initialData?: Partial<FormData>
  submitLabel?: string
  isLoading?: boolean
}

const props = withDefaults(defineProps<NotificationFormProps>(), {
  submitLabel: 'Create Notification',
  isLoading: false,
})

const emit = defineEmits<{
  submit: [data: FormData]
  cancel?: []
}>()

// Form state
const formData = ref<FormData>({
  title: props.initialData?.title || '',
  message: props.initialData?.message || '',
  type: props.initialData?.type || 'info',
  target_type: props.initialData?.target_type || 'role',
  target_id: props.initialData?.target_id || '',
  is_active: props.initialData?.is_active ?? true,
})

// Form validation
const errors = ref<Record<string, string>>({})

// Options
const typeOptions = [
  { value: 'info', label: 'Info', class: 'text-blue-600' },
  { value: 'warning', label: 'Warning', class: 'text-yellow-600' },
  { value: 'success', label: 'Success', class: 'text-green-600' },
  { value: 'error', label: 'Error', class: 'text-red-600' },
]

const targetTypeOptions = [
  { value: 'role', label: 'Role' },
  { value: 'workspace', label: 'Workspace' },
]

const roleOptions = [
  { value: 'owner', label: 'Owners' },
  { value: 'member', label: 'Members' },
]

// Fetch workspaces for targeting
const { data: workspaces } = await useFetch('/api/admin/workspaces')

// Watch target_type changes to reset target_id
watch(() => formData.value.target_type, () => {
  formData.value.target_id = ''
})

function validateForm(): boolean {
  errors.value = {}

  if (!formData.value.title.trim())
    errors.value.title = 'Title is required'

  if (!formData.value.message.trim())
    errors.value.message = 'Message is required'

  if (!formData.value.target_id)
    errors.value.target_id = 'Target is required'

  return Object.keys(errors.value).length === 0
}

function handleSubmit() {
  if (!validateForm())
    return

  emit('submit', { ...formData.value })
}

function handleCancel() {
  emit('cancel')
}

// Update form data when initialData changes (for edit mode)
watch(() => props.initialData, (newData) => {
  if (newData) {
    formData.value = {
      title: newData.title || '',
      message: newData.message || '',
      type: newData.type || 'info',
      target_type: newData.target_type || 'role',
      target_id: newData.target_id || '',
      is_active: newData.is_active ?? true,
    }
  }
}, { immediate: true })
</script>

<template>
  <form class="space-y-6" @submit.prevent="handleSubmit">
    <!-- Title -->
    <div>
      <label for="title" class="block text-sm font-medium text-gray-700">
        Title *
      </label>
      <input
        id="title"
        v-model="formData.title"
        type="text"
        required
        class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        :class="{ 'border-red-300': errors.title }"
        placeholder="Notification title"
      >
      <p v-if="errors.title" class="mt-1 text-sm text-red-600">
        {{ errors.title }}
      </p>
    </div>

    <!-- Type -->
    <div>
      <label for="type" class="block text-sm font-medium text-gray-700">
        Type
      </label>
      <select
        id="type"
        v-model="formData.type"
        class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
      >
        <option v-for="option in typeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Message -->
    <div>
      <label for="message" class="block text-sm font-medium text-gray-700">
        Message *
      </label>
      <textarea
        id="message"
        v-model="formData.message"
        rows="4"
        required
        class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        :class="{ 'border-red-300': errors.message }"
        placeholder="Notification message..."
      />
      <p v-if="errors.message" class="mt-1 text-sm text-red-600">
        {{ errors.message }}
      </p>
    </div>

    <!-- Target Type -->
    <div>
      <label for="target-type" class="block text-sm font-medium text-gray-700">
        Target Type *
      </label>
      <select
        id="target-type"
        v-model="formData.target_type"
        class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
      >
        <option v-for="option in targetTypeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Target Selection -->
    <div>
      <label for="target-id" class="block text-sm font-medium text-gray-700">
        Target *
      </label>
      <select
        id="target-id"
        v-model="formData.target_id"
        required
        class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        :class="{ 'border-red-300': errors.target_id }"
      >
        <option value="">
          Select target...
        </option>
        <template v-if="formData.target_type === 'role'">
          <option v-for="role in roleOptions" :key="role.value" :value="role.value">
            {{ role.label }}
          </option>
        </template>
        <template v-if="formData.target_type === 'workspace'">
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
            {{ workspace.name }}
          </option>
        </template>
      </select>
      <p v-if="errors.target_id" class="mt-1 text-sm text-red-600">
        {{ errors.target_id }}
      </p>
    </div>

    <!-- Active Status -->
    <div class="flex items-center">
      <input
        id="is-active"
        v-model="formData.is_active"
        type="checkbox"
        class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
      >
      <label for="is-active" class="ml-2 block text-sm text-gray-900">
        Active (notification will be visible to users)
      </label>
    </div>

    <!-- Form Actions -->
    <div class="flex justify-end space-x-3">
      <button
        v-if="$slots.cancel"
        type="button"
        class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        @click="handleCancel"
      >
        Cancel
      </button>
      <the-button
        type="submit"
        :disabled="isLoading"
        class="relative"
      >
        <span :class="{ 'pr-6': isLoading }">{{ submitLabel }}</span>
        <span v-if="isLoading" class="absolute top-1/2 -translate-y-1/2 right-2">
          <app-loading class="w-6 h-6" />
        </span>
      </the-button>
    </div>
  </form>
</template>
