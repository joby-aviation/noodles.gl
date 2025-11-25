import React, { useEffect } from 'react';
import NotFound from '@theme-original/NotFound';
import { useLocation } from '@docusaurus/router';
import type { Props } from '@theme/NotFound';

export default function NotFoundWrapper(props: Props): JSX.Element {
  const location = useLocation();

  useEffect(() => {
    // Check if the 404 path belongs to the app
    if (location.pathname.startsWith('/app/')) {
      // Redirect to the SPA root with the path as a query param
      // Match this query param key ('redirect') to what your SPA expects
      const redirectPath = location.pathname + location.search + location.hash;
      window.location.replace(
        `/app/?redirect=${encodeURIComponent(redirectPath)}`
      );
    }
  }, [location]);

  // Render the standard Docusaurus 404 for all other paths
  return <NotFound {...props} />;
}
