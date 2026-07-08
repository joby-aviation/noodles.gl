import type { CustomChecks } from './types'
import { customChecks as modifyArcs } from './modify-arcs'
import { customChecks as debugBlankViz } from './debug-blank-viz'
import { customChecks as sqlH3Pipeline } from './sql-h3-pipeline'
import { customChecks as animateCamera } from './animate-camera'
import { customChecks as codeRefsContainers } from './code-refs-containers'
import { customChecks as hikingTime } from './hiking-time'

export const CUSTOM_CHECKS: Record<string, CustomChecks> = {
  'modify-arcs': modifyArcs,
  'debug-blank-viz': debugBlankViz,
  'sql-h3-pipeline': sqlH3Pipeline,
  'animate-camera': animateCamera,
  'code-refs-containers': codeRefsContainers,
  'hiking-time': hikingTime,
}

export type { CheckContext, CheckResult, CustomChecks, ProjectJson } from './types'
