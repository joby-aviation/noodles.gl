// Fires on every SPA route change (Docusaurus client lifecycle).
// posthog.init with capture_pageview:true handles the first load;
// this catches subsequent in-app navigations that don't trigger a full page reload.
export function onRouteDidUpdate({ location, previousLocation }) {
  if (!window.posthog) return
  if (!previousLocation) return
  if (location.pathname !== previousLocation.pathname) {
    window.posthog.capture('$pageview', { $current_url: window.location.href })
  }
}
