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
					The animation studio for maps. Build cinematic, data-driven
					geospatial stories — entirely in the browser.
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
		description:
			"Animated arc flows across 1M+ trips with real-time brushing and filtering",
		tag: "Animated",
		wide: true,
		example: "nyc-taxis",
	},
	{
		media: "/img/example-world-flights.png",
		type: "image" as const,
		title: "World Flights",
		description:
			"Arc layer with camera flythrough, animated by timestamp and colored by airline",
		tag: "Cinematic",
		wide: false,
		example: "world-flights",
	},
	{
		media: "/img/example-chargemap.png",
		type: "image" as const,
		title: "EV Charging Network",
		description:
			"Live DuckDB query drives a heatmap that updates as filters change",
		tag: "Data-driven",
		wide: false,
		example: "chargers",
	},
	{
		media: "/img/example-california-earthquakes.png",
		type: "image" as const,
		title: "California Earthquakes",
		description:
			"Magnitude-scaled scatter with animated time window and turbo color ramp",
		tag: "Scientific",
		wide: false,
		example: "california-earthquakes",
	},
	{
		media: "/img/example-us-unemployment.png",
		type: "image" as const,
		title: "US County Unemployment",
		description:
			"Choropleth driven by SQL, exportable as print-resolution image or video",
		tag: "Publication",
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
						Animated maps, data-driven storytelling, and publication-quality
						renders — all from visual pipelines
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

function Positioning() {
	return (
		<section className={styles.positioningSection}>
			<div className="container">
				<div className={styles.sectionHeader}>
					<Heading as="h2" className={styles.sectionTitle}>
						Static maps tell facts. Animated maps tell stories.
					</Heading>
					<p className={styles.sectionSubtitle}>
						Most mapping tools stop at the screenshot. Noodles.gl starts
						there — giving you a full keyframe timeline, reactive data
						pipelines, and cinema-quality GPU rendering to turn spatial data
						into narrative.
					</p>
				</div>
				<div className={styles.positioningGrid}>
					<div className={styles.positioningCard}>
						<h3>Timeline-first design</h3>
						<p>
							Every parameter in your visualization is animatable. Camera
							position, arc height, filter threshold, color ramp midpoint —
							set keyframes, adjust bezier curves, scrub through time.
							The workflow motion designers already know, applied to maps.
						</p>
					</div>
					<div className={styles.positioningCard}>
						<h3>Reactive, not static</h3>
						<p>
							Wire a DuckDB query to a heatmap layer. Change the WHERE
							clause and the map updates in the same frame. Chain ten
							transforms together — the whole pipeline stays live. No
							re-runs, no stale caches.
						</p>
					</div>
					<div className={styles.positioningCard}>
						<h3>40+ GPU layer types</h3>
						<p>
							Arcs, trips, hexagons, heatmaps, point clouds, 3D columns,
							contours, great circles, icon clusters — each rendered at
							60fps on the GPU via Deck.gl. Handle millions of data points
							without dropping frames.
						</p>
					</div>
					<div className={styles.positioningCard}>
						<h3>Export anything</h3>
						<p>
							MP4 video at any framerate and resolution. High-DPI PNG stills
							for print. Interactive embeds for the web. Or drive the
							visualization live from external tools via the MCP API.
						</p>
					</div>
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
						From raw data to cinematic map animation — the full workflow in
						under 5 minutes
					</p>
				</div>
				<div className={styles.videoOuter}>
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
			</div>
		</section>
	);
}

const useCases = [
	{
		headline: "Keyframe everything",
		body: "Camera position, layer opacity, filter thresholds, colors, radii — every parameter is animatable. Scrub with a professional timeline editor, shape curves with bezier handles, and export directly to video.",
		icon: "🎬",
	},
	{
		headline: "Reactive data pipelines",
		body: "Wire a SQL query to a map layer; when the query changes, the map updates instantly. Chain transforms, filters, and visual encodings as a live graph — no run button, no waiting.",
		icon: "⚡",
	},
	{
		headline: "Cinema-quality map renders",
		body: "40+ GPU-accelerated layer types: arcs, heatmaps, hexagons, trip animations, 3D columns, point clouds. Export at any resolution — 4K video, print-ready stills, or interactive web embeds.",
		icon: "🗺️",
	},
	{
		headline: "Ship it, share it, replay it",
		body: "Every project is a portable JSON file. Hand it to a colleague — they get the exact same visualization, data pipeline, and animation. No environment drift, no missing dependencies.",
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
						Connect operators like building blocks — data flows through the
						graph and the map updates live.
					</p>
				</div>
				<div className={styles.pipelineRow}>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>1</div>
						<div className={styles.pipelineStepContent}>
							<h3>Load your data</h3>
							<p>
								CSV, GeoJSON, GeoParquet, live APIs, or SQL queries via
								DuckDB
							</p>
						</div>
					</div>
					<div className={styles.pipelineArrow}>→</div>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>2</div>
						<div className={styles.pipelineStepContent}>
							<h3>Compose the pipeline</h3>
							<p>
								Chain transforms, pick a layer type, configure visual
								encodings — all with drag-and-drop
							</p>
						</div>
					</div>
					<div className={styles.pipelineArrow}>→</div>
					<div className={styles.pipelineStep}>
						<div className={styles.pipelineStepNum}>3</div>
						<div className={styles.pipelineStepContent}>
							<h3>Animate and export</h3>
							<p>
								Keyframe any value, scrub the timeline, then export to MP4,
								high-res PNG, or interactive embed
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
					Your data deserves motion
				</Heading>
				<p className={styles.ctaSectionSubtitle}>
					Open-source, runs entirely in the browser, no install required.
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
			description="The animation studio for maps. Build cinematic, data-driven geospatial stories with keyframeable pipelines — entirely in the browser."
		>
			<HomepageHeader />
			<main>
				<ShowcaseGallery />
				<Positioning />
				<VideoSection />
				<UseCases />
				<HowItWorks />
				<CTASection />
			</main>
		</Layout>
	);
}
