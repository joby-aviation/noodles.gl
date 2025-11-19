import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import HomepageFeatures from '@site/src/components/HomepageFeatures'
import MediaShowcase from '@site/src/components/MediaShowcase'
import Heading from '@theme/Heading'
import Layout from '@theme/Layout'
import clsx from 'clsx'

import styles from './index.module.css'

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext()

  const appUrl = process.env.NODE_ENV === 'development' ? '' : '/app'

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <img src="/img/noodles.png" alt="Noodles.gl" className={styles.heroLogo} />
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <a
            className={clsx('button button--primary button--lg', styles.ctaButton)}
            href={`${appUrl}/examples/nyc-taxis`}
          >
            Launch Editor
          </a>
          <Link className="button button--secondary button--lg" to="/intro">
            Read Docs
          </Link>
        </div>
      </div>
    </header>
  )
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={'Home'}
      description="Interactive geospatial visualization and animation platform"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <MediaShowcase />
      </main>
    </Layout>
  )
}
