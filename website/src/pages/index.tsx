import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import clsx from "clsx";

import styles from "./index.module.css";

function HomepageHeader() {
	const { siteConfig } = useDocusaurusContext();
	const appUrl = process.env.NODE_ENV === "development" ? "" : "/app";

	return (
		<header className={styles.hero}>
			<div className={styles.heroBg}>
				<img
					src="/img/example-joby-storytelling.png"
					alt=""
					className={styles.heroBgImage}
					aria-hidden="true"
				/>
				<div className={styles.heroBgOverlay} />
			</div>
			<div className={clsx("container", styles.heroContent)}>
				<img
					src="/img/noodles-favicon.svg"
					alt=""
					className={styles.heroIcon}
					aria-hidden="true"
				/>
				<Heading as="h1" className={styles.heroTitle}>
					{siteConfig.title}
				</Heading>
				<p className={styles.heroSubtitle}>
					Turn geospatial data into stunning, animated visualizations — no
					coding required.
				</p>
				<div className={styles.heroButtons}>
					<a
						className={clsx(
							"button button--primary button--lg",
							styles.ctaButton,
						)}
						href={`${appUrl}/`}
					>
						Launch Editor
					</a>
					<Link
						className={clsx(
							"button button--secondary button--lg",
							styles.secondaryButton,
						)}
						to="/intro"
					>
						Read Docs
					</Link>
				</div>
			</div>
		</header>
	);
}

const showcaseItems = [
	{
		media: "/img/example-nyc-taxi-brushing.mp4",
		type: "video" as const,
		title: "NYC Taxi Trips",
		description: "Brush and filter 1M+ trips in real time",
		tag: "Transportation",
		wide: true,
		example: "nyc-taxis",
	},
	{
		media: "/img/example-world-flights.png",
		type: "image" as const,
		title: "World Flights",
		description: "Animated flight paths colored by origin country",
		tag: "Aviation",
		wide: false,
		example: "world-flights",
	},
	{
		media: "/img/example-chargemap.png",
		type: "image" as const,
		title: "EV Charging Network",
		description: "Live API data across thousands of stations",
		tag: "Energy",
		wide: false,
		example: "chargers",
	},
	{
		media: "/img/example-california-earthquakes.png",
		type: "image" as const,
		title: "California Earthquakes",
		description: "Magnitude-scaled scatter with turbo color ramp",
		tag: "Science",
		wide: false,
		example: "california-earthquakes",
	},
	{
		media: "/img/example-us-unemployment.png",
		type: "image" as const,
		title: "US County Unemployment",
		description: "Choropleth map with DuckDB SQL aggregation",
		tag: "Economics",
		wide: false,
		example: "us-county-unemployment",
	},
];

function ShowcaseGallery() {
	const appUrl = process.env.NODE_ENV === "development" ? "" : "/app";
	return (
		<section className={styles.gallerySection}>
			<div className="container">
				<div className={styles.sectionHeader}>
					<Heading as="h2" className={styles.sectionTitle}>
						Built with Noodles.gl
					</Heading>
					<p className={styles.sectionSubtitle}>
						From quick explorations to polished, publication-ready renders
					</p>
				</div>
				<div className={styles.galleryGrid}>
					{showcaseItems.map((item, i) => (
						<a
							key={i}
							href={`${appUrl}/examples/${item.example}`}
							className={clsx(
								styles.galleryCard,
								item.wide && styles.galleryCardWide,
							)}
						>
							<div className={styles.galleryMedia}>
								{item.type === "video" ? (
									<video
										src={item.media}
										autoPlay
										loop
										muted
										playsInline
										className={styles.galleryMediaEl}
									/>
								) : (
									<img
										src={item.media}
										alt={item.title}
										className={styles.galleryMediaEl}
									/>
								)}
								<div className={styles.galleryOverlay}>
									<span className={styles.galleryTag}>{item.tag}</span>
									<div className={styles.galleryInfo}>
										<h3 className={styles.galleryTitle}>{item.title}</h3>
										<p className={styles.galleryDesc}>{item.description}</p>
									</div>
								</div>
							</div>
						</a>
					))}
				</div>
			</div>
		</section>
	);
}

function VideoSection() {
	return (
		<section className={styles.videoSection}>
			<div className="container">
				<div className={styles.sectionHeader}>
					<Heading as="h2" className={styles.sectionTitle}>
						See it in action
					</Heading>
					<p className={styles.sectionSubtitle}>
						Watch how Noodles.gl turns raw data into animated, interactive maps
					</p>
				</div>
				<div className={styles.videoWrapper}>
					<iframe
						className={styles.videoEmbed}
						src="https://www.youtube.com/embed/GJ0ftFB8r4I"
						title="Noodles.gl Demo"
						frameBorder="0"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowFullScreen
					/>
				</div>
			</div>
		</section>
	);
}

const useCases = [
	{
		headline: "Animate anything on a map",
		body: "Keyframe any parameter — color, size, opacity, position — and scrub through time with a professional timeline editor. Export to video for presentations or share as interactive web pages.",
		icon: "🎬",
	},
	{
		headline: "Connect data, see results instantly",
		body: "Load a CSV, drag a few nodes, and your data appears on a WebGL-rendered globe. Changes propagate through the graph in real time — no manual refreshes, no waiting.",
		icon: "⚡",
	},
	{
		headline: "From prototype to publication",
		body: "Start with built-in layers like heatmaps, arc flows, and hexagonal bins. Add custom JavaScript when you need it. Export at print resolution when you're done.",
		icon: "🗺️",
	},
	{
		headline: "Reproducible workflows",
		body: "Every project is a JSON file. Share it with a colleague, open it six months later, and get the exact same result. No hidden state, no version drift.",
		icon: "🔁",
	},
];

function UseCases() {
	return (
		<section className={styles.useCasesSection}>
			<div className="container">
				<div className={styles.sectionHeader}>
					<Heading as="h2" className={styles.sectionTitle}>
						What you can do with it
					</Heading>
				</div>
				<div className={styles.useCasesGrid}>
					{useCases.map((item, i) => (
						<div key={i} className={styles.useCaseCard}>
							<div className={styles.useCaseIcon}>{item.icon}</div>
							<h3 className={styles.useCaseHeadline}>{item.headline}</h3>
							<p className={styles.useCaseBody}>{item.body}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function HowItWorks() {
	return (
		<section className={styles.howItWorksSection}>
			<div className="container">
				<div className={styles.sectionHeader}>
					<Heading as="h2" className={styles.sectionTitle}>
						Visual data pipelines
					</Heading>
					<p className={styles.sectionSubtitle}>
						Connect operators like building blocks. Each node does one thing
						well.
					</p>
				</div>
				<div className={styles.pipelineRow}>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>1</div>
						<div className={styles.pipelineStepContent}>
							<h3>Load your data</h3>
							<p>CSV, GeoJSON, JSON, live APIs, or SQL queries via DuckDB</p>
						</div>
					</div>
					<div className={styles.pipelineArrow}>→</div>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>2</div>
						<div className={styles.pipelineStepContent}>
							<h3>Build your graph</h3>
							<p>
								Filter, transform, and wire up visualization layers with
								drag-and-drop nodes
							</p>
						</div>
					</div>
					<div className={styles.pipelineArrow}>→</div>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>3</div>
						<div className={styles.pipelineStepContent}>
							<h3>Render and share</h3>
							<p>
								Animate with the timeline, export to video, or embed as an
								interactive map
							</p>
						</div>
					</div>
				</div>
				<div className={styles.workflowImageContainer}>
					<img
						src="/img/noodles-nyc-taxis-graph.png"
						alt="Noodles.gl node graph — NYC Taxis dataset with arc layer and scatterplot layers"
						className={styles.workflowImage}
					/>
				</div>
			</div>
		</section>
	);
}

function CTASection() {
	const appUrl = process.env.NODE_ENV === "development" ? "" : "/app";
	return (
		<section className={styles.ctaSection}>
			<div className="container">
				<Heading as="h2" className={styles.ctaSectionTitle}>
					Ready to visualize your data?
				</Heading>
				<p className={styles.ctaSectionSubtitle}>
					Open-source, runs in the browser, no install required.
				</p>
				<div className={styles.heroButtons}>
					<a
						className={clsx(
							"button button--primary button--lg",
							styles.ctaButton,
						)}
						href={`${appUrl}/`}
					>
						Launch Editor
					</a>
					<Link
						className={clsx(
							"button button--secondary button--lg",
							styles.secondaryButton,
						)}
						to="/users/getting-started"
					>
						Get Started →
					</Link>
				</div>
			</div>
		</section>
	);
}

export default function Home() {
	const { siteConfig } = useDocusaurusContext();
	return (
		<Layout
			title={"Home"}
			description="Turn geospatial data into stunning, animated visualizations — no coding required."
		>
			<HomepageHeader />
			<main>
				<ShowcaseGallery />
				<VideoSection />
				<UseCases />
				<HowItWorks />
				<CTASection />
			</main>
		</Layout>
	);
}
