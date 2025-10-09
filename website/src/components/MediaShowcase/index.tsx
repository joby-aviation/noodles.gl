import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

export default function MediaShowcase(): ReactNode {
  return (
    <section className={styles.showcase}>
      <div className="container">
        <div className={styles.showcaseHeader}>
          <Heading as="h2" className={styles.showcaseTitle}>
            See It In Action
          </Heading>
          <p className={styles.showcaseSubtitle}>
            Explore powerful geospatial visualizations and animations
          </p>
        </div>

        {/* Video Section */}
        <div className={styles.videoContainer}>
          <div className={styles.videoWrapper}>
            <iframe
              className={styles.video}
              src="https://www.youtube.com/embed/GJ0ftFB8r4I"
              title="Noodles.gl Demo"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className={styles.videoCaption}>
            <Heading as="h3">Interactive Visualizations</Heading>
            <p>
              Noodles.gl brings data to life with smooth animations,
              3D maps, and interactive storytelling capabilities.
            </p>
          </div>
        </div>

        {/* Image Gallery */}
        <div className={styles.gallery}>
          <div className={styles.galleryItem}>
            <div className={styles.galleryImage}>
              <video
                src="/img/example-nyc-taxi-brushing.mp4"
                autoPlay
                loop
                muted
                className={styles.screenshotVideo}></video>
            </div>
            <div className={styles.galleryCaption}>
              <Heading as="h4">Dynamic Maps</Heading>
              <p>Visualize complex geospatial data with ease</p>
              <p>High performance rendering using WebGL and Deck.gl</p>
            </div>
          </div>

          <div className={styles.galleryItem}>
            <div className={styles.galleryImage}>
              <img
                src="/img/example-chargemap.png"
                alt="Example ChargeMap Screenshot"
                className={styles.screenshotImage} />
            </div>
            <div className={styles.galleryCaption}>
              <Heading as="h4">Fast geospatial apps</Heading>
              <p>Create quick apps and repeatable workflows that makes dataflow understandable</p>
            </div>
          </div>

          <div className={styles.galleryItem}>
            <div className={styles.galleryImage}>
              <img
                src="/img/example-joby-storytelling.png"
                alt="Example Joby Storytelling Screenshot"
                className={styles.screenshotImage} />
            </div>
            <div className={styles.galleryCaption}>
              <Heading as="h4">Data Storytelling</Heading>
              <p>Combine data and narrative for impact</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
