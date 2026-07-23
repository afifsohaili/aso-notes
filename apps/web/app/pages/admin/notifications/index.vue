<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
  layout: 'default',
})

// Form state
const title = ref('')
const message = ref('')
const type = ref<'info' | 'warning' | 'success' | 'error'>('info')
const targetType = ref<'workspace' | 'role'>('role')
const targetId = ref('')
const isActive = ref(true)
const isSubmitting = ref(false)

// Pagination and filtering
const currentPage = ref(1)
const pageSize = ref(25)
const searchQuery = ref('')
const filterType = ref<string>('')
const filterTargetType = ref<string>('')
const filterIsActive = ref<string>('true')

// Preview modal
const showPreview = ref(false)
const previewNotification = ref<any>(null)

// Inline editing
const editingNotificationId = ref<number | null>(null)
const editingData = ref<any>({})

const { showErrorAlert, showSuccessAlert } = useGlobalAlert()

// Type options
const typeOptions = [
  { value: 'info', label: 'Info', class: 'text-blue-600' },
  { value: 'warning', label: 'Warning', class: 'text-yellow-600' },
  { value: 'success', label: 'Success', class: 'text-green-600' },
  { value: 'error', label: 'Error', class: 'text-red-600' },
]

// Target type options
const targetTypeOptions = [
  { value: 'role', label: 'Role' },
  { value: 'workspace', label: 'Workspace' },
]

// Role options
const roleOptions = [
  { value: 'owner', label: 'Owners' },
  { value: 'member', label: 'Members' },
]

// Page size options
const pageSizeOptions = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: 'All' },
]

// Fetch workspaces for targeting
const { data: workspaces } = await useFetch('/api/admin/workspaces')

// Fetch notifications with filters
const { data: notificationsData, refresh: refreshNotifications } = await useFetch('/api/admin/notifications', {
  query: computed(() => ({
    page: currentPage.value,
    limit: pageSize.value,
    ...(searchQuery.value && { search: searchQuery.value }),
    ...(filterType.value && { type: filterType.value }),
    ...(filterTargetType.value && { target_type: filterTargetType.value }),
    ...(filterIsActive.value !== '' && { is_active: filterIsActive.value }),
  })),
})

const notifications = computed(() => notificationsData.value?.notifications || [])
const totalNotifications = computed(() => notificationsData.value?.total || 0)
const totalPages = computed(() => {
  if (pageSize.value === 'all')
    return 1
  return Math.ceil(totalNotifications.value / (pageSize.value as number))
})

// Watch for filter changes to reset to page 1
watch([searchQuery, filterType, filterTargetType, filterIsActive, pageSize], () => {
  currentPage.value = 1
})

// Inline editing functions
function startEdit(notification: any) {
  editingNotificationId.value = notification.id
  editingData.value = { ...notification }
}

function cancelEdit() {
  editingNotificationId.value = null
  editingData.value = {}
}

function isEditing(notificationId: number) {
  return editingNotificationId.value === notificationId
}

function getTypeClass(notificationType: string) {
  const typeOption = typeOptions.find(opt => opt.value === notificationType)
  return typeOption?.class || 'text-gray-600'
}

function getTargetDisplay(notification: any) {
  if (notification.target_type === 'workspace') {
    const workspace = workspaces.value?.find((o: any) => o.id === notification.target_id)
    return `${workspace?.name || 'Unknown Workspace'}`
  }
  else if (notification.target_type === 'role') {
    const role = roleOptions.find(r => r.value === notification.target_id)
    return `All ${role?.label || notification.target_id}`
  }
  return 'Unknown'
}

async function createNotification() {
  if (!title.value.trim() || !message.value.trim()) {
    showErrorAlert('Please provide both title and message', 'Validation Error')
    return
  }

  if (!targetId.value) {
    showErrorAlert('Please select a target', 'Validation Error')
    return
  }

  isSubmitting.value = true
  try {
    await $fetch('/api/admin/notifications', {
      method: 'POST',
      body: {
        title: title.value.trim(),
        message: message.value.trim(),
        type: type.value,
        target_type: targetType.value,
        target_id: targetId.value,
        is_active: isActive.value,
      },
    })

    showSuccessAlert('Notification created successfully!', 'Success', { clearAfter: 3000 })

    // Reset form
    title.value = ''
    message.value = ''
    type.value = 'info'
    targetType.value = 'role'
    targetId.value = ''
    isActive.value = true

    // Refresh notifications list
    await refreshNotifications()
  }
  catch (error: any) {
    console.error('Failed to create notification:', error)
    const errorMessage = error?.data?.statusMessage || error?.message || 'Failed to create notification'
    showErrorAlert(errorMessage, 'Error')
  }
  finally {
    isSubmitting.value = false
  }
}

function openPreview(notification: any) {
  previewNotification.value = notification
  showPreview.value = true
}

async function saveEdit() {
  if (!editingData.value || !editingNotificationId.value)
    return

  try {
    await $fetch(`/api/admin/notifications/${editingNotificationId.value}`, {
      method: 'PUT',
      body: {
        title: editingData.value.title,
        message: editingData.value.message,
        type: editingData.value.type,
        target_type: editingData.value.target_type,
        target_id: editingData.value.target_id,
        is_active: editingData.value.is_active,
      },
    })

    showSuccessAlert('Notification updated successfully!', 'Success', { clearAfter: 3000 })
    cancelEdit()
    await refreshNotifications()
  }
  catch (error: any) {
    console.error('Failed to update notification:', error)
    const errorMessage = error?.data?.statusMessage || error?.message || 'Failed to update notification'
    showErrorAlert(errorMessage, 'Error')
  }
}

async function deleteNotification(notification: any) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Are you sure you want to delete "${notification.title}"?`))
    return

  try {
    await $fetch(`/api/admin/notifications/${notification.id}`, {
      method: 'DELETE',
    })

    showSuccessAlert('Notification deleted successfully!', 'Success', { clearAfter: 3000 })
    await refreshNotifications()
  }
  catch (error: any) {
    console.error('Failed to delete notification:', error)
    const errorMessage = error?.data?.statusMessage || error?.message || 'Failed to delete notification'
    showErrorAlert(errorMessage, 'Error')
  }
}

async function toggleActive(notification: any) {
  try {
    await $fetch(`/api/admin/notifications/${notification.id}`, {
      method: 'PUT',
      body: {
        is_active: !notification.is_active,
      },
    })

    showSuccessAlert(`Notification ${!notification.is_active ? 'activated' : 'deactivated'} successfully!`, 'Success', { clearAfter: 2000 })
    await refreshNotifications()
  }
  catch (error: any) {
    console.error('Failed to toggle notification status:', error)
    const errorMessage = error?.data?.statusMessage || error?.message || 'Failed to update notification'
    showErrorAlert(errorMessage, 'Error')
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto">
      <!-- Create Notification Form -->
      <div class="bg-white shadow rounded-lg mb-8">
        <div class="px-4 py-5 border-b border-gray-200 sm:px-6">
          <h3 class="text-lg leading-6 font-medium text-gray-900">
            Create Notification
          </h3>
          <p class="mt-1 max-w-2xl text-sm text-gray-500">
            Send notifications to users based on workspace or role.
          </p>
        </div>

        <div class="px-4 py-5 sm:p-6">
          <form class="space-y-6" @submit.prevent="createNotification">
            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label for="title" class="block text-sm font-medium text-gray-700">
                  Title *
                </label>
                <input
                  id="title"
                  v-model="title"
                  type="text"
                  required
                  class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Notification title"
                >
              </div>

              <div>
                <label for="type" class="block text-sm font-medium text-gray-700">
                  Type
                </label>
                <select
                  id="type"
                  v-model="type"
                  class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option v-for="option in typeOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label for="message" class="block text-sm font-medium text-gray-700">
                Message *
              </label>
              <textarea
                id="message"
                v-model="message"
                rows="4"
                required
                class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Notification message..."
              />
            </div>

            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label for="target-type" class="block text-sm font-medium text-gray-700">
                  Target Type *
                </label>
                <select
                  id="target-type"
                  v-model="targetType"
                  class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  @change="targetId = ''"
                >
                  <option v-for="option in targetTypeOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>

              <div>
                <label for="target-id" class="block text-sm font-medium text-gray-700">
                  Target *
                </label>
                <select
                  id="target-id"
                  v-model="targetId"
                  required
                  class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">
                    Select target...
                  </option>
                  <template v-if="targetType === 'role'">
                    <option v-for="role in roleOptions" :key="role.value" :value="role.value">
                      {{ role.label }}
                    </option>
                  </template>
                  <template v-if="targetType === 'workspace'">
                    <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
                      {{ workspace.name }}
                    </option>
                  </template>
                </select>
              </div>
            </div>

            <div class="flex items-center">
              <input
                id="is-active"
                v-model="isActive"
                type="checkbox"
                class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              >
              <label for="is-active" class="ml-2 block text-sm text-gray-900">
                Active (notification will be visible to users)
              </label>
            </div>

            <div class="flex justify-end">
              <the-button type="submit" :disabled="isSubmitting">
                <span :class="{ 'pr-6': isSubmitting }">Create Notification</span>
                <span v-if="isSubmitting" class="absolute top-1/2 -translate-y-1/2 right-2">
                  <app-loading class="w-6 h-6" />
                </span>
              </the-button>
            </div>
          </form>
        </div>
      </div>

      <!-- Notifications Table -->
      <div class="bg-white shadow rounded-lg">
        <div class="px-4 py-5 border-b border-gray-200 sm:px-6">
          <h3 class="text-lg leading-6 font-medium text-gray-900">
            All Notifications
          </h3>
          <p class="mt-1 max-w-2xl text-sm text-gray-500">
            Manage existing notifications.
          </p>
        </div>

        <!-- Filters -->
        <div class="px-4 py-4 border-b border-gray-200 bg-gray-50">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search title/message..."
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
            </div>
            <div>
              <select
                v-model="filterType"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="">
                  All Types
                </option>
                <option v-for="option in typeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div>
              <select
                v-model="filterTargetType"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="">
                  All Targets
                </option>
                <option v-for="option in targetTypeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div>
              <select
                v-model="filterIsActive"
                class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="">
                  All Status
                </option>
                <option value="true">
                  Active
                </option>
                <option value="false">
                  Inactive
                </option>
              </select>
            </div>
          </div>
        </div>

        <div class="overflow-hidden">
          <table v-if="notifications.length > 0" class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title & Message
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Target
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="notification in notifications" :key="notification.id">
                <!-- Title & Message Column -->
                <td class="px-6 py-4">
                  <div v-if="!isEditing(notification.id)" class="max-w-xs">
                    <div class="text-sm font-medium text-gray-900 truncate">
                      {{ notification.title }}
                    </div>
                    <div class="text-sm text-gray-500 truncate">
                      {{ notification.message }}
                    </div>
                  </div>
                  <div v-else class="max-w-xs space-y-2">
                    <input
                      v-model="editingData.title"
                      type="text"
                      class="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Title"
                    >
                    <textarea
                      v-model="editingData.message"
                      rows="2"
                      class="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Message"
                    />
                  </div>
                </td>

                <!-- Type Column -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span v-if="!isEditing(notification.id)" :class="getTypeClass(notification.type)" class="text-sm font-medium capitalize">
                    {{ notification.type }}
                  </span>
                  <select
                    v-else
                    v-model="editingData.type"
                    class="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option v-for="option in typeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </td>

                <!-- Target Column -->
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <span v-if="!isEditing(notification.id)">
                    {{ getTargetDisplay(notification) }}
                  </span>
                  <div v-else class="space-y-1">
                    <select
                      v-model="editingData.target_type"
                      class="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      @change="editingData.target_id = ''"
                    >
                      <option v-for="option in targetTypeOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                    <select
                      v-model="editingData.target_id"
                      class="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">
                        Select target...
                      </option>
                      <template v-if="editingData.target_type === 'role'">
                        <option v-for="role in roleOptions" :key="role.value" :value="role.value">
                          {{ role.label }}
                        </option>
                      </template>
                      <template v-if="editingData.target_type === 'workspace'">
                        <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
                          {{ workspace.name }}
                        </option>
                      </template>
                    </select>
                  </div>
                </td>

                <!-- Status Column -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span
                    v-if="!isEditing(notification.id)"
                    :class="notification.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'"
                    class="inline-flex px-2 py-1 text-xs font-semibold rounded-full"
                  >
                    {{ notification.is_active ? 'Active' : 'Inactive' }}
                  </span>
                  <label v-else class="flex items-center">
                    <input
                      v-model="editingData.is_active"
                      type="checkbox"
                      class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    >
                    <span class="ml-2 text-sm text-gray-700">Active</span>
                  </label>
                </td>

                <!-- Created Date Column -->
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {{ new Date(notification.created_at).toLocaleDateString() }}
                </td>

                <!-- Actions Column -->
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <template v-if="!isEditing(notification.id)">
                    <button
                      class="text-blue-600 hover:text-blue-900"
                      @click="openPreview(notification)"
                    >
                      Preview
                    </button>
                    <button
                      class="text-green-600 hover:text-green-900"
                      @click="startEdit(notification)"
                    >
                      Edit
                    </button>
                    <button
                      :class="notification.is_active ? 'text-yellow-600 hover:text-yellow-900' : 'text-green-600 hover:text-green-900'"
                      @click="toggleActive(notification)"
                    >
                      {{ notification.is_active ? 'Deactivate' : 'Activate' }}
                    </button>
                    <button
                      class="text-red-600 hover:text-red-900"
                      @click="deleteNotification(notification)"
                    >
                      Delete
                    </button>
                  </template>
                  <template v-else>
                    <button
                      class="text-green-600 hover:text-green-900"
                      @click="saveEdit"
                    >
                      Save
                    </button>
                    <button
                      class="text-gray-600 hover:text-gray-900"
                      @click="cancelEdit"
                    >
                      Cancel
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else class="px-6 py-12 text-center text-gray-500">
            No notifications found.
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="notifications.length > 0" class="px-6 py-3 bg-gray-50 border-t border-gray-200">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="text-sm text-gray-700">
                Showing {{ Math.min((currentPage - 1) * (pageSize as number) + 1, totalNotifications) }}-{{ Math.min(currentPage * (pageSize as number), totalNotifications) }} of {{ totalNotifications }} notifications
              </span>
              <select
                v-model="pageSize"
                class="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option v-for="option in pageSizeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div v-if="pageSize !== 'all'" class="flex space-x-2">
              <button
                :disabled="currentPage === 1"
                :class="currentPage === 1 ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50'"
                class="px-3 py-1 border border-gray-300 rounded-md text-sm"
                @click="currentPage--"
              >
                Previous
              </button>
              <span class="px-3 py-1 text-sm text-gray-700">
                {{ currentPage }} of {{ totalPages }}
              </span>
              <button
                :disabled="currentPage === totalPages"
                :class="currentPage === totalPages ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50'"
                class="px-3 py-1 border border-gray-300 rounded-md text-sm"
                @click="currentPage++"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="showPreview" class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="showPreview = false" />
        <div class="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div class="sm:flex sm:items-start">
            <div class="w-full">
              <h3 class="text-lg leading-6 font-medium text-gray-900 mb-4">
                Notification Preview
              </h3>
              <div v-if="previewNotification" class="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div class="flex items-start space-x-3">
                  <div :class="getTypeClass(previewNotification.type)" class="flex-shrink-0">
                    <svg v-if="previewNotification.type === 'info'" class="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                    </svg>
                    <svg v-else-if="previewNotification.type === 'warning'" class="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                    <svg v-else-if="previewNotification.type === 'success'" class="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                    </svg>
                    <svg v-else-if="previewNotification.type === 'error'" class="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-gray-900">
                      {{ previewNotification.title }}
                    </div>
                    <div class="text-sm text-gray-700 mt-1">
                      {{ previewNotification.message }}
                    </div>
                    <div class="text-xs text-gray-500 mt-2">
                      {{ new Date(previewNotification.created_at).toLocaleDateString() }}
                    </div>
                  </div>
                </div>
              </div>
              <div class="mt-4 text-sm text-gray-600">
                <p><strong>Target:</strong> {{ getTargetDisplay(previewNotification) }}</p>
                <p><strong>Type:</strong> {{ previewNotification?.type }}</p>
                <p><strong>Status:</strong> {{ previewNotification?.is_active ? 'Active' : 'Inactive' }}</p>
              </div>
            </div>
          </div>
          <div class="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
              @click="showPreview = false"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
