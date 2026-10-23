// Adds site components to every doc page, so MDX can use them without an import.
import OpenInEditor, { EditorLink, StartExamples } from '@site/src/components/OpenInEditor'
import MDXComponents from '@theme-original/MDXComponents'

export default {
  ...MDXComponents,
  OpenInEditor,
  EditorLink,
  StartExamples,
}
