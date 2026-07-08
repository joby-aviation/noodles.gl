import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExampleNotFoundDialog } from '../example-not-found-dialog'

describe('ExampleNotFoundDialog', () => {
  const createProps = () => ({
    projectName: 'test-project',
    open: true,
    onBrowseExamples: vi.fn(),
    onCheckMyProjects: vi.fn(),
    onClose: vi.fn(),
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders dialog with correct title when open', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      expect(screen.getByText('Example Not Found')).toBeInTheDocument()
    })

    it('displays the project name in the description', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      // Use getByRole to get the description element, which contains the project name
      const description = screen.getByRole('dialog').querySelector('p')
      expect(description).toHaveTextContent('test-project')
    })

    it('renders Browse Examples button', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      expect(screen.getByRole('button', { name: 'Browse Examples' })).toBeInTheDocument()
    })

    it('renders Check My Projects button', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      expect(screen.getByRole('button', { name: 'Check My Projects' })).toBeInTheDocument()
    })

    it('renders close button', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })

    it('does not render dialog content when open is false', () => {
      const props = createProps()
      props.open = false
      render(<ExampleNotFoundDialog {...props} />)
      // When open is false, no dialog role element should be present
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('callbacks', () => {
    it('calls onBrowseExamples when Browse Examples button is clicked', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Browse Examples' }))
      expect(props.onBrowseExamples).toHaveBeenCalledTimes(1)
    })

    it('calls onCheckMyProjects when Check My Projects button is clicked', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Check My Projects' }))
      expect(props.onCheckMyProjects).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when close button is clicked', () => {
      const props = createProps()
      render(<ExampleNotFoundDialog {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('with different project names', () => {
    it('displays custom project name', () => {
      const props = createProps()
      props.projectName = 'my-custom-project'
      render(<ExampleNotFoundDialog {...props} />)
      const description = screen.getByRole('dialog').querySelector('p')
      expect(description).toHaveTextContent('my-custom-project')
    })

    it('handles project names with special characters', () => {
      const props = createProps()
      props.projectName = 'project-with-dashes_and_underscores'
      render(<ExampleNotFoundDialog {...props} />)
      const description = screen.getByRole('dialog').querySelector('p')
      expect(description).toHaveTextContent('project-with-dashes_and_underscores')
    })
  })
})
