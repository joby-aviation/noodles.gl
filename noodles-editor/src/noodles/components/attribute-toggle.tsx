import { CubeIcon, InputIcon, MixIcon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback } from 'react'
import s from './attribute-toggle.module.css'

export type AttributeMode = 'uniform' | 'attribute' | 'expression'

interface AttributeToggleProps {
  mode: AttributeMode
  onChange: (mode: AttributeMode) => void
  disabled?: boolean
}

const icons = {
  uniform: CubeIcon,
  attribute: InputIcon,
  expression: MixIcon,
}

const labels = {
  uniform: 'Uniform value',
  attribute: 'Read from attribute',
  expression: 'Expression',
}

export function AttributeToggle({ mode, onChange, disabled }: AttributeToggleProps) {
  const handleClick = useCallback(() => {
    if (disabled) return

    const modes: AttributeMode[] = ['uniform', 'attribute', 'expression']
    const currentIndex = modes.indexOf(mode)
    const nextIndex = (currentIndex + 1) % modes.length
    onChange(modes[nextIndex])
  }, [mode, onChange, disabled])

  const Icon = icons[mode]

  return (
    <button
      type="button"
      className={cx(s.toggle, {
        [s.disabled]: disabled,
        [s.uniform]: mode === 'uniform',
        [s.attribute]: mode === 'attribute',
        [s.expression]: mode === 'expression',
      })}
      onClick={handleClick}
      disabled={disabled}
      title={labels[mode]}
      aria-label={labels[mode]}
    >
      <Icon className={s.icon} />
    </button>
  )
}
