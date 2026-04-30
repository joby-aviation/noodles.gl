import { Toast } from 'primereact/toast'
import { useEffect, useRef } from 'react'
import './save-reminder-toast.module.css'

interface SaveReminderToastProps {
  hasUnsavedChanges: boolean
  onSave: () => void
}

const REMINDER_DELAY = 2 * 60 * 1000 // 2 minutes in milliseconds

export function SaveReminderToast({ hasUnsavedChanges, onSave }: SaveReminderToastProps) {
  const toast = useRef<Toast>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const hasShownToast = useRef(false)

  useEffect(() => {
    // Start timer when there are unsaved changes
    if (hasUnsavedChanges && !hasShownToast.current) {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      // Start new timer
      timerRef.current = setTimeout(() => {
        toast.current?.show({
          severity: 'warn',
          summary: 'Unsaved Changes',
          detail: 'You have unsaved changes. Save your project to avoid losing work.',
          life: 10000, // Show for 10 seconds
          sticky: false,
          closable: true,
        })
        hasShownToast.current = true
      }, REMINDER_DELAY)
    }

    // Reset when changes are saved
    if (!hasUnsavedChanges) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      hasShownToast.current = false
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [hasUnsavedChanges])

  return <Toast ref={toast} position="bottom-right" />
}
