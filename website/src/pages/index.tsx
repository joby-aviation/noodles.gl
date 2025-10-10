import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import MediaShowcase from '@site/src/components/MediaShowcase';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  // In development, the app runs on a different port (Vite)
  // In production, it's served from /app/
  const appUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173/?project=new'
    : '/app/?project=new';

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <img
          src="/img/noodles.png"
          alt="Noodles.gl"
          className={styles.heroLogo}
        />
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <a
            className={clsx('button button--primary button--lg', styles.ctaButton)}
            href={appUrl}>
            Launch Editor
          </a>
          <Link
            className="button button--secondary button--lg"
            to="/intro">
            Read Docs
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`Home`}
      description="Interactive geospatial visualization and animation platform">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <MediaShowcase />
      </main>
    </Layout>
  );
}
