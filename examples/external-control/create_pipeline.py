#!/usr/bin/env python3
"""
Example: Create a data pipeline using external control from Python

This script demonstrates how to control Noodles from Python, which is useful for:
- Data science workflows
- Automated testing
- Integration with AI tools like Claude Code

Requirements:
- pip install websocket-client

Usage:
1. Start the bridge server: node server-example.js
2. Open Noodles with external control: http://localhost:5173/examples/nyc-taxis?externalControl=true
3. Run this script: python create_pipeline.py
"""

import json
import time
import websocket
from typing import Dict, Any, List


class NoodlesClient:
    """Python client for Noodles external control"""

    def __init__(self, host: str = "localhost", port: int = 8765, debug: bool = False):
        self.host = host
        self.port = port
        self.debug = debug
        self.ws = None
        self.message_id = 0

    def connect(self) -> None:
        """Connect to Noodles external control server"""
        url = f"ws://{self.host}:{self.port}"
        if self.debug:
            print(f"Connecting to {url}")

        self.ws = websocket.create_connection(url)

        # Send connect message
        self.send_message("connect", {
            "clientId": f"python-client-{time.time()}",
            "version": "1.0.0",
            "capabilities": ["pipeline", "tools", "state"]
        })

        if self.debug:
            print("Connected!")

    def disconnect(self) -> None:
        """Disconnect from server"""
        if self.ws:
            self.ws.close()
            self.ws = None

    def send_message(self, msg_type: str, payload: Dict[str, Any]) -> str:
        """Send a message and return its ID"""
        self.message_id += 1
        message = {
            "id": f"py-{self.message_id}-{time.time()}",
            "type": msg_type,
            "timestamp": int(time.time() * 1000),
            "payload": payload
        }

        if self.debug:
            print(f"Sending: {msg_type}")

        self.ws.send(json.dumps(message))
        return message["id"]

    def wait_for_response(self, message_id: str, timeout: int = 30) -> Dict[str, Any]:
        """Wait for a response to a specific message"""
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                response = self.ws.recv()
                data = json.loads(response)

                if self.debug:
                    print(f"Received: {data.get('type')}")

                # Check if this is the response we're waiting for
                if data.get("id") == message_id:
                    return data

            except websocket.WebSocketTimeoutException:
                continue

        raise TimeoutError(f"No response received for message {message_id}")

    def call_tool(self, tool: str, args: Dict[str, Any]) -> Any:
        """Call a tool and wait for response"""
        msg_id = self.send_message("tool_call", {
            "tool": tool,
            "args": args
        })

        response = self.wait_for_response(msg_id)

        if response["type"] == "tool_error":
            raise Exception(f"Tool error: {response['payload']['error']['message']}")

        return response["payload"]["result"]

    def create_pipeline(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        """Create a data pipeline"""
        msg_id = self.send_message("pipeline_create", {
            "spec": spec,
            "options": {
                "validateFirst": True,
                "autoConnect": True
            }
        })

        response = self.wait_for_response(msg_id)

        if response["type"] == "tool_error":
            raise Exception(f"Pipeline creation failed: {response['payload']['error']['message']}")

        return response["payload"]["result"]

    def test_pipeline(self, pipeline_id: str, test_data: List[Dict]) -> Dict[str, Any]:
        """Test a pipeline with sample data"""
        msg_id = self.send_message("pipeline_test", {
            "pipelineId": pipeline_id,
            "testData": test_data,
            "options": {
                "timeout": 30000,
                "captureIntermediateResults": True
            }
        })

        response = self.wait_for_response(msg_id)

        if response["type"] == "tool_error":
            raise Exception(f"Pipeline test failed: {response['payload']['error']['message']}")

        return response["payload"]["result"]

    def capture_visualization(self, format: str = "png", quality: float = 0.9) -> Dict[str, Any]:
        """Capture a screenshot of the visualization"""
        return self.call_tool("captureVisualization", {
            "format": format,
            "quality": quality
        })

    def get_current_project(self) -> Dict[str, Any]:
        """Get the current project state"""
        return self.call_tool("getCurrentProject", {})


def main():
    """Example: Create and test a data pipeline"""

    # Create client
    client = NoodlesClient(debug=True)

    try:
        # Connect to Noodles
        client.connect()

        # Create a data pipeline for NYC taxi data using nodes and edges
        print("\nCreating data pipeline...")
        pipeline_spec = {
            "nodes": [
                {
                    "id": "/file-loader",
                    "type": "FileOp",
                    "position": {"x": 100, "y": 100},
                    "data": {
                        "inputs": {
                            "url": "@/nyc-taxis.csv",
                            "format": "csv"
                        }
                    }
                },
                {
                    "id": "/filter",
                    "type": "FilterOp",
                    "position": {"x": 100, "y": 250},
                    "data": {
                        "inputs": {
                            "expression": "d.passenger_count > 2"
                        }
                    }
                },
                {
                    "id": "/map",
                    "type": "MapOp",
                    "position": {"x": 100, "y": 400},
                    "data": {
                        "inputs": {
                            "expression": """({
                                ...d,
                                trip_duration_minutes: d.trip_duration / 60,
                                speed_mph: (d.trip_distance / d.trip_duration) * 3600
                            })"""
                        }
                    }
                },
                {
                    "id": "/scatterplot",
                    "type": "ScatterplotLayerOp",
                    "position": {"x": 100, "y": 550},
                    "data": {
                        "inputs": {
                            "getPosition": "d => [d.pickup_longitude, d.pickup_latitude]",
                            "getRadius": "d => Math.min(d.trip_duration_minutes * 10, 500)",
                            "getFillColor": "d => d.passenger_count > 3 ? [255, 0, 0] : [0, 0, 255]",
                            "opacity": 0.5
                        }
                    }
                }
            ],
            "edges": [
                {
                    "source": "/file-loader",
                    "target": "/filter",
                    "sourceHandle": "out.data",
                    "targetHandle": "par.data"
                },
                {
                    "source": "/filter",
                    "target": "/map",
                    "sourceHandle": "out.result",
                    "targetHandle": "par.data"
                },
                {
                    "source": "/map",
                    "target": "/scatterplot",
                    "sourceHandle": "out.result",
                    "targetHandle": "par.data"
                }
            ]
        }

        pipeline = client.create_pipeline(pipeline_spec)
        print(f"Pipeline created: {pipeline['pipelineId']}")

        # Wait for rendering
        time.sleep(2)

        # Capture visualization
        print("\nCapturing visualization...")
        screenshot = client.capture_visualization()
        print(f"Screenshot captured: {len(screenshot.get('data', ''))} bytes")

        # Get project state
        print("\nGetting project state...")
        project = client.get_current_project()
        print(f"Project has {len(project['nodes'])} nodes and {len(project['edges'])} edges")

        # Test with sample data
        print("\nTesting pipeline with sample data...")
        test_data = [
            {
                "pickup_longitude": -73.98,
                "pickup_latitude": 40.75,
                "passenger_count": 3,
                "trip_duration": 600,
                "trip_distance": 2.5
            },
            {
                "pickup_longitude": -73.97,
                "pickup_latitude": 40.76,
                "passenger_count": 4,
                "trip_duration": 900,
                "trip_distance": 3.2
            }
        ]

        test_result = client.test_pipeline(pipeline["pipelineId"], test_data)
        print(f"Test result: {'Success' if test_result['success'] else 'Failed'}")

        print("\nPipeline creation complete!")

    except Exception as e:
        print(f"Error: {e}")

    finally:
        # Disconnect
        print("\nDisconnecting...")
        client.disconnect()


if __name__ == "__main__":
    main()