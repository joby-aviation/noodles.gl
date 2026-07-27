import { type ReactNode, useState } from 'react'
import s from './sidebar-tabs.module.css'

interface SidebarTabsProps {
  tabs: { id: string; label: string; icon: string; content: ReactNode }[]
}

export function SidebarTabs({ tabs }: SidebarTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? '')

  const active = tabs.find(t => t.id === activeTab) ?? tabs[0]

  return (
    <div className={s.container}>
      <div className={s.tabBar}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${s.tab} ${tab.id === activeTab ? s.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            <i className={`pi ${tab.icon}`} />
            <span className={s.tabLabel}>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className={s.content}>{active?.content}</div>
    </div>
  )
}
