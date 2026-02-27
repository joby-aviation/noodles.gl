/**
 * Example: Create a data pipeline using external control
 *
 * This script demonstrates how to:
 * 1. Connect to Noodles via WebSocket
 * 2. Create a data pipeline programmatically
 * 3. Test the pipeline with sample data
 * 4. Capture the visualization
 *
 * Usage:
 * 1. Start Noodles with external control enabled:
 *    http://localhost:5173/examples/nyc-taxis?externalControl=true&externalControlDebug=true
 * 2. Start a WebSocket server (see server-example.js)
 * 3. Run this script: node create-pipeline.js
 */

// Import the client (in a real scenario, this would be from npm package)
import { NoodlesClient } from '../../noodles-editor/src/external-control/client.js'

async function main() {
  // Create client instance
  const client = new NoodlesClient({
    host: 'localhost',
    port: 8765,
    debug: true,
  })

  try {
    // Connect to Noodles
    console.log('Connecting to Noodles...')
    await client.connect()
    console.log('Connected!')

    // Create a data pipeline using nodes and edges
    console.log('Creating data pipeline...')
    const pipeline = await client.createPipeline({
      nodes: [
        {
          id: '/file-loader',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              url: '@/nyc-taxis.csv', // Use project data file
              format: 'csv',
            },
          },
        },
        {
          id: '/filter',
          type: 'FilterOp',
          position: { x: 100, y: 250 },
          data: {
            inputs: {
              expression: 'd.passenger_count > 2', // Filter for rides with more than 2 passengers
            },
          },
        },
        {
          id: '/map',
          type: 'MapOp',
          position: { x: 100, y: 400 },
          data: {
            inputs: {
              expression: `({
                ...d,
                trip_duration_minutes: d.trip_duration / 60,
                speed_mph: (d.trip_distance / d.trip_duration) * 3600
              })`, // Calculate trip duration in minutes and speed
            },
          },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 100, y: 550 },
          data: {
            inputs: {
              getPosition: 'd => [d.pickup_longitude, d.pickup_latitude]',
              getRadius: 'd => Math.min(d.trip_duration_minutes * 10, 500)',
              getFillColor: 'd => d.passenger_count > 3 ? [255, 0, 0] : [0, 0, 255]',
              opacity: 0.5,
            },
          },
        },
      ],
      edges: [
        {
          source: '/file-loader',
          target: '/filter',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          source: '/filter',
          target: '/map',
          sourceHandle: 'out.result',
          targetHandle: 'par.data',
        },
        {
          source: '/map',
          target: '/scatterplot',
          sourceHandle: 'out.result',
          targetHandle: 'par.data',
        },
      ],
    })

    console.log('Pipeline created:', pipeline)

    // Wait for the pipeline to be ready
    console.log('Waiting for pipeline to render...')
    await client.waitUntilReady()

    // Capture the visualization
    console.log('Capturing visualization...')
    const screenshot = await client.captureVisualization('png', 0.9)
    console.log('Screenshot captured, size:', screenshot.data.length, 'bytes')

    // Get the current project state
    console.log('Getting project state...')
    const projectState = await client.getCurrentProject()
    console.log('Project has', projectState.nodes.length, 'nodes and', projectState.edges.length, 'edges')

    // Validate the pipeline
    console.log('Validating pipeline...')
    const validation = await client.validatePipeline(pipeline.pipelineId)
    console.log('Validation result:', validation.valid ? 'Valid' : 'Invalid')
    if (!validation.valid) {
      console.log('Errors:', validation.errors)
    }

    // Test with sample data (optional)
    // Note: testPipeline injects test data at the first node (FileOp), replacing its output.
    // The data format should match what a parsed CSV produces: an array of row objects.
    // Each object has properties matching CSV column headers with auto-typed values.
    console.log('Testing pipeline with sample data...')
    const testData = [
      // Sample rows matching the expected nyc-taxis.csv schema
      {
        pickup_longitude: -73.98,
        pickup_latitude: 40.75,
        passenger_count: 3,
        trip_duration: 600,
        trip_distance: 2.5,
      },
      {
        pickup_longitude: -73.97,
        pickup_latitude: 40.76,
        passenger_count: 4,
        trip_duration: 900,
        trip_distance: 3.2,
      },
      {
        pickup_longitude: -73.99,
        pickup_latitude: 40.74,
        passenger_count: 1, // Will be filtered out (filter is passenger_count > 2)
        trip_duration: 300,
        trip_distance: 1.0,
      },
    ]

    const testResult = await client.testPipeline(pipeline.pipelineId, testData)
    console.log('Test result:', testResult.success ? 'Success' : 'Failed')
    if (testResult.success) {
      console.log('Output records:', testResult.outputCount)
    }

  } catch (error) {
    console.error('Error:', error)
  } finally {
    // Disconnect
    console.log('Disconnecting...')
    client.disconnect()
  }
}

// Run the example
main().catch(console.error)