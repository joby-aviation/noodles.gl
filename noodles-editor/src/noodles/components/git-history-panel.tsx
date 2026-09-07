import { useCallback, useEffect, useState } from 'react'
import type { Commit, GitService } from '../utils/git-service'
import { createGitService } from '../utils/git-service'
import { useUIStore } from '../store'
import styles from './git-history-panel.module.css'

interface GitHistoryPanelProps {
  projectDirectory: FileSystemDirectoryHandle | null
  onClose: () => void
}

export function GitHistoryPanel({ projectDirectory, onClose }: GitHistoryPanelProps) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null)

  const loadHistory = useCallback(async () => {
    if (!projectDirectory) {
      setError('No project directory available')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const gitService = await createGitService(projectDirectory)

      if (!(await gitService.isGitRepo())) {
        setError('This project is not a git repository')
        setCommits([])
        setLoading(false)
        return
      }

      const history = await gitService.log({ maxCount: 100 })
      setCommits(history)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load git history')
      setCommits([])
    } finally {
      setLoading(false)
    }
  }, [projectDirectory])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'just now'
  }

  const copyCommitHash = (oid: string) => {
    navigator.clipboard.writeText(oid)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Version History</h2>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading history...</p>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={loadHistory} className={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && commits.length === 0 && (
        <div className={styles.empty}>
          <p>No commits yet</p>
          <p className={styles.emptyHint}>Make changes and save to create your first commit</p>
        </div>
      )}

      {!loading && !error && commits.length > 0 && (
        <div className={styles.content}>
          <div className={styles.commitList}>
            {commits.map(commit => (
              <div
                key={commit.oid}
                className={`${styles.commitItem} ${selectedCommit?.oid === commit.oid ? styles.selected : ''}`}
                onClick={() => setSelectedCommit(commit)}
              >
                <div className={styles.commitHeader}>
                  <span className={styles.commitHash} onClick={() => copyCommitHash(commit.oid)}>
                    {commit.oid.substring(0, 7)}
                  </span>
                  <span className={styles.commitTime}>
                    {formatRelativeTime(commit.author.timestamp)}
                  </span>
                </div>
                <div className={styles.commitMessage}>{commit.message}</div>
                <div className={styles.commitAuthor}>{commit.author.name}</div>
              </div>
            ))}
          </div>

          {selectedCommit && (
            <div className={styles.commitDetails}>
              <h3 className={styles.detailsTitle}>Commit Details</h3>
              <div className={styles.detailsContent}>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Commit:</span>
                  <span className={styles.detailValue}>
                    {selectedCommit.oid}
                    <button
                      className={styles.copyButton}
                      onClick={() => copyCommitHash(selectedCommit.oid)}
                      title="Copy commit hash"
                    >
                      Copy
                    </button>
                  </span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Author:</span>
                  <span className={styles.detailValue}>{selectedCommit.author.name}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Email:</span>
                  <span className={styles.detailValue}>{selectedCommit.author.email}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Date:</span>
                  <span className={styles.detailValue}>
                    {formatDate(selectedCommit.author.timestamp)}
                  </span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Message:</span>
                  <span className={styles.detailValue}>{selectedCommit.message}</span>
                </div>
                {selectedCommit.parent && selectedCommit.parent.length > 0 && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Parent:</span>
                    <span className={styles.detailValue}>
                      {selectedCommit.parent[0].substring(0, 7)}
                    </span>
                  </div>
                )}
              </div>
              <div className={styles.detailsFooter}>
                <p className={styles.footerNote}>Diff viewer coming in Phase 2</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
