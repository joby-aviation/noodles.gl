import type { CustomChecks } from './types'
import { customChecks as modifyArcs } from './modify-arcs'
import { customChecks as debugBlankViz } from './debug-blank-viz'
import { customChecks as sqlH3Pipeline } from './sql-h3-pipeline'
import { customChecks as animateCamera } from './animate-camera'
import { customChecks as codeRefsContainers } from './code-refs-containers'
import { customChecks as hikingTime } from './hiking-time'
import { customChecks as mapFlightsLastWeek } from './map-flights-last-week'
import { customChecks as animateFlightRoute } from './animate-flight-route'
import { customChecks as quickStartScreenshot } from './quick-start-screenshot'

export const CUSTOM_CHECKS: Record<string, CustomChecks> = {
  'modify-arcs': modifyArcs,
  'debug-blank-viz': debugBlankViz,
  'sql-h3-pipeline': sqlH3Pipeline,
  'animate-camera': animateCamera,
  'code-refs-containers': codeRefsContainers,
  'hiking-time': hikingTime,
  'map-flights-last-week': mapFlightsLastWeek,
  'animate-flight-route': animateFlightRoute,
  'quick-start-screenshot': quickStartScreenshot,
}

export type { CheckContext, CheckResult, CustomChecks, ProjectJson } from './types'
