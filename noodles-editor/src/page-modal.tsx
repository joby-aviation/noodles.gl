import { Cross2Icon } from '@radix-ui/react-icons'
import { type ReactNode, useCallback, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import s from './page-modal.module.css'

interface PageModalProps {
  children: ReactNode
}

export function PageModal({ children }: PageModalProps) {
  const [location, navigate] = useLocation()

  const handleClose = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      navigate('/')
    }
  }, [navigate])

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  return (
    <div className={s.overlay}>
      <div className={s.header}>
        <nav className={s.nav}>
          <Link
            href="/projects"
            className={`${s.navLink} ${location === '/projects' ? s.navLinkActive : ''}`}
          >
            Projects
          </Link>
          <Link
            href="/examples"
            className={`${s.navLink} ${location === '/examples' ? s.navLinkActive : ''}`}
          >
            Examples
          </Link>
        </nav>
        <button
          type="button"
          className={s.closeButton}
          onClick={handleClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          <Cross2Icon width={14} height={14} />
        </button>
      </div>
      <div className={s.body}>{children}</div>
    </div>
  )
}
