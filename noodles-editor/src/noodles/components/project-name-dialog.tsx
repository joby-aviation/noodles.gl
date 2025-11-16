/**
 * Project Name Dialog
 *
 * Prompts user to enter a project name with validation.
 * Extracted from menu.tsx SaveProjectDialog for reuse.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback, useState } from 'react'
import s from './menu.module.css'

export interface ProjectNameDialogProps {
	/**
	 * Default project name (if any)
	 */
	defaultName?: string

	/**
	 * Callback when user confirms with valid name
	 */
	onComplete: (name: string | null) => void
}

/**
 * Dialog for prompting user to enter project name
 */
export function ProjectNameDialog({ defaultName, onComplete }: ProjectNameDialogProps) {
	const [tempProjectName, setTempProjectName] = useState(defaultName || '')
	const [error, setError] = useState<string | null>(null)

	const onSave = useCallback(() => {
		if (!tempProjectName) {
			setError('Project name is required')
			return
		}
		// Theatre.js requirement
		if (tempProjectName.length < 3 || tempProjectName.length > 32) {
			setError('Project name must be between 3 and 32 characters')
			return
		}
		// For OPFS, needs to match filesystem restrictions
		// biome-ignore lint/suspicious/noControlCharactersInRegex: From https://github.com/sindresorhus/filename-reserved-regex
		if (/[<>:"/\\|?*\u0000-\u001F]/g.test(tempProjectName)) {
			const matches = tempProjectName.match(/([<>:"/\\|?*\u0000-\u001F])/g)
			const char = matches?.[0] || 'special character'

			setError(
				`Project name cannot contain special characters (e.g. <, >, :, ", /, \\, |, ?, *, \u0000-\u001F). Found: ${char}`
			)
			return
		}
		setError(null)
		onComplete(tempProjectName)
	}, [onComplete, tempProjectName])

	const onCancel = useCallback(() => {
		onComplete(null)
	}, [onComplete])

	return (
		<Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
			<Dialog.Portal>
				<Dialog.Overlay className={s.dialogOverlay} />
				<Dialog.Content className={s.dialogContent}>
					<Dialog.Title className={s.dialogTitle}>Save project</Dialog.Title>
					<Dialog.Description className={s.dialogDescription}>
						Name your project. Click save when you're done.
					</Dialog.Description>
					{error && <p className={s.dialogError}>{error}</p>}
					<fieldset className={s.dialogFieldset}>
						<label className={s.dialogLabel} htmlFor="project-name">
							Name
						</label>
						<input
							className={s.dialogInput}
							id="project-name"
							required
							value={tempProjectName}
							onChange={(e) => setTempProjectName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault()
									onSave()
								}
							}}
							autoFocus
						/>
					</fieldset>
					<div className={s.dialogRightSlot}>
						<button type="button" className={s.dialogButton} onClick={onCancel}>
							Cancel
						</button>
						<button type="button" className={cx(s.dialogButton, s.green)} onClick={onSave}>
							Save
						</button>
					</div>
					<Dialog.Close asChild>
						<button type="button" className={s.dialogIconButton} aria-label="Close" onClick={onCancel}>
							<Cross2Icon />
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
