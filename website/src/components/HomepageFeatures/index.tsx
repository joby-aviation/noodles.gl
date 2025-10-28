import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Timeline Animation',
    icon: '🎬',
    description: (
      <>
        Built on Theatre.js for professional animation timeline control.
        Create smooth, synchronized animations with precise timing control.
      </>
    ),
  },
  {
    title: 'Geospatial Visualization',
    icon: '🌍',
    description: (
      <>
        Powered by Deck.gl and MapLibre for stunning 3D geospatial visualizations.
        Render aviation routes, terrain, and interactive maps with ease.
      </>
    ),
  },
  {
    title: 'Interactive Stories',
    icon: '📊',
    description: (
      <>
        Create compelling data stories with interactive presentations.
        Combine datasets, animations, and visualizations into engaging narratives.
      </>
    ),
  },
  {
    title: 'Node-Based Workflow',
    icon: '🔗',
    description: (
      <>
        Intuitive visual programming with a powerful node graph editor.
        Connect operators to build complex data pipelines without code.
      </>
    ),
  },
  {
    title: 'Real-Time Performance',
    icon: '⚡',
    description: (
      <>
        GPU-accelerated rendering powered by WebGL for smooth 60fps performance.
        Handle massive datasets with optimized data structures and rendering.
      </>
    ),
  },
  {
    title: 'Open Source & Extensible',
    icon: '🚀',
    description: (
      <>
        Fully open-source with a modular architecture.
        Build custom operators, data sources, and visualizations to fit your needs.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <div className={styles.featureIcon} role="img">{icon}</div>
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
